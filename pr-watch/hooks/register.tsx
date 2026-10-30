import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Ci, Codex, PrRow, Snapshot } from '../types'

const PANE = 'pr-watch'
const OWNER = 'zapdingbat777'
const REPOS = ['Quinn-HOA', 'MoBotBrain', 'mobot-claude-mods']
const EVERY_MS = 3 * 60 * 1000
// The GitHub connector's name differs by where the session runs.
const SERVERS = ['github', 'claude.ai GitHub', 'GitHub']
// Workflows that are review triggers, not CI.
const NOT_CI = new Set(['codex', 'claude', 'trigger-codex'])
const FAILED = new Set(['failure', 'timed_out', 'cancelled', 'startup_failure'])

const EMPTY: Snapshot = { rows: [], refreshedAt: null, errors: [], isLoading: false }
// Change the tag when Snapshot's fields change: it declines what an earlier
// version stored, which outlives a reload.
const snapshot = atom({ plugin: 'pr-watch', key: 'snapshot' } as const, EMPTY, {
  shape: 'snapshot-1',
})

type Call = (tool: string, args: Record<string, unknown>) => Promise<any>

type CheckRun = { name: string; status: string; conclusion: string | null }
type Review = { user?: { login?: string }; commit_id?: string; submitted_at?: string }

export function summarizeCi(runs: CheckRun[]): { ci: Ci; failedChecks: string[] } {
  const real = runs.filter(
    r => !NOT_CI.has(r.name) && r.conclusion !== 'skipped' && r.conclusion !== 'neutral',
  )
  const failedChecks = real.filter(r => FAILED.has(r.conclusion ?? '')).map(r => r.name)
  if (failedChecks.length) return { ci: 'failed', failedChecks }
  // A bot-pushed commit's runs wait for approval and never execute.
  if (real.some(r => r.conclusion === 'action_required')) return { ci: 'stuck', failedChecks }
  if (real.some(r => r.status !== 'completed')) return { ci: 'running', failedChecks }
  if (real.some(r => r.conclusion === 'success')) return { ci: 'passed', failedChecks }
  return { ci: 'none', failedChecks }
}

// Codex leaves a review only when it has findings, and a 👍 when it has none.
// The owner never 👍s on these repos, so any 👍 is Codex's.
export function summarizeCodex(reviews: Review[], thumbsUp: number, headSha: string): Codex {
  const codex = reviews.filter(r => r.user?.login?.includes('codex'))
  if (codex.some(r => r.commit_id === headSha)) return 'findings'
  if (thumbsUp > 0) return 'clean'
  if (codex.length) return 'stale'
  return 'pending'
}

// MCP tools answer with one JSON text block.
function json(result: { content: { type: string; text?: string }[]; isError: boolean }): any {
  const text = result.content.map(b => (b.type === 'text' ? b.text ?? '' : '')).join('')
  if (result.isError) throw new Error(text || 'GitHub call failed')
  return JSON.parse(text)
}

async function fetchRepo(call: Call, repo: string): Promise<PrRow[]> {
  const prs: any[] = await call('list_pull_requests', {
    owner: OWNER,
    repo,
    state: 'open',
    perPage: 30,
    fields: ['number', 'title', 'draft', 'html_url', 'head', 'updated_at'],
  })

  return Promise.all(
    prs.map(async pr => {
      const base = { owner: OWNER, repo, pullNumber: pr.number }
      const [detail, checks, issue, reviews] = await Promise.all([
        call('pull_request_read', { ...base, method: 'get' }),
        call('pull_request_read', { ...base, method: 'get_check_runs' }),
        call('issue_read', { owner: OWNER, repo, issue_number: pr.number, method: 'get' }),
        call('pull_request_read', { ...base, method: 'get_reviews' }),
      ])
      const headSha: string = detail.head?.sha ?? pr.head?.sha ?? ''
      const { ci, failedChecks } = summarizeCi(checks.check_runs ?? [])
      const row: PrRow = {
        repo,
        number: pr.number,
        title: pr.title,
        url: pr.html_url,
        isDraft: Boolean(pr.draft),
        ci,
        failedChecks,
        codex: summarizeCodex(reviews ?? [], issue.reactions?.['+1'] ?? 0, headSha),
        mergeState: detail.mergeable_state ?? 'unknown',
        updatedAt: pr.updated_at,
      }
      return row
    }),
  )
}

const CI_LABEL: Record<Ci, string> = {
  passed: '✅ CI',
  failed: '❌ CI',
  running: '⏳ CI',
  stuck: '⚠️ CI stuck',
  none: '⚪ no CI',
}
const CODEX_LABEL: Record<Codex, string> = {
  clean: '👍 Codex',
  findings: '💬 Codex findings',
  stale: '↻ Codex re-review',
  pending: '… Codex',
}
const MERGE_LABEL: Record<string, string> = {
  clean: 'mergeable',
  dirty: 'conflicts',
  behind: 'behind main',
  blocked: 'blocked',
  unstable: 'unstable',
  draft: 'draft',
}

export function age(fromIso: string, now: number): string {
  const mins = Math.max(0, Math.round((now - Date.parse(fromIso)) / 60000))
  if (mins < 60) return `${mins}m`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

export function statusLine(r: PrRow, now: number): string {
  const failed = r.failedChecks.length ? ` (${r.failedChecks.join(', ')})` : ''
  const merge = MERGE_LABEL[r.mergeState] ?? r.mergeState
  return `${CI_LABEL[r.ci]}${failed} · ${CODEX_LABEL[r.codex]} · ${merge} · ${age(r.updatedAt, now)} ago`
}

// The same list as the pane, as markdown for the transcript, for sessions
// with no surface that can draw a pane.
export function asText(s: Snapshot, now: number): string {
  const lines: string[] = []
  for (const err of s.errors) lines.push(`⚠️ ${err}`)
  for (const repo of REPOS) {
    const rows = s.rows.filter(r => r.repo === repo)
    if (!rows.length) continue
    lines.push(`**${repo}**`)
    for (const r of rows) {
      lines.push(`- [#${r.number}](${r.url}) ${r.isDraft ? '(draft) ' : ''}${r.title}`)
      lines.push(`  ${statusLine(r, now)}`)
    }
  }
  if (!s.rows.length && !s.errors.length) lines.push('No open PRs.')
  if (s.refreshedAt) lines.push(`_Updated ${laTime(s.refreshedAt)} PT_`)
  return lines.join('\n')
}

export function laTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: '2-digit',
  })
}

// The refresh under way, so a second ask waits for it instead of returning early.
let inFlight: Promise<void> | undefined
// Remembers which name the GitHub connector answered to in this session.
let githubServer: string | undefined

async function callGithub($: EngineInterface, tool: string, args: Record<string, unknown>): Promise<any> {
  if (githubServer) return json(await $.mcp.call(githubServer, tool, args))
  let lastErr: unknown
  for (const name of SERVERS) {
    try {
      const result = json(await $.mcp.call(name, tool, args))
      githubServer = name
      return result
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr
}

function refresh($: EngineInterface): Promise<void> {
  inFlight ??= fetchAll($).finally(() => {
    inFlight = undefined
  })
  return inFlight
}

async function fetchAll($: EngineInterface): Promise<void> {
  await update($, snapshot, s => ({ ...s, isLoading: true }))
  try {
    const call: Call = (tool, args) => callGithub($, tool, args)
    const errors: string[] = []
    const perRepo = await Promise.all(
      REPOS.map(repo =>
        fetchRepo(call, repo).catch(err => {
          errors.push(`${repo}: ${err instanceof Error ? err.message : String(err)}`)
          return [] as PrRow[]
        }),
      ),
    )
    const now = await $.clock.now()
    await update($, snapshot, () => ({ rows: perRepo.flat(), refreshedAt: now, errors, isLoading: false }))
  } catch (err) {
    await update($, snapshot, s => ({ ...s, isLoading: false, errors: [String(err)] }))
  }
}

async function openPane($: EngineInterface): Promise<void> {
  await $.ui.open({ id: PANE, title: 'Pull requests' })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'prs',
      description: 'Show open PRs with CI, Codex and merge state in a side panel',
    })
    void openPane($)
    void refresh($)
    $.clock.every(EVERY_MS, () => refresh($))
    return next(e)
  })

  on('command.run', { command: 'prs' }, async $ => {
    // An unasked open at session start can leave the pane open but unplaced,
    // and opening the same id again only retitles it, so close it first.
    const before = await $.ui.panes()
    if (before.some(p => p.id === PANE && !p.isPlaced)) await $.ui.close({ id: PANE })
    const opened = await $.ui.open({ id: PANE, title: 'Pull requests', focus: true })
    if (opened.isPlaced) {
      void refresh($)
      return { text: 'PR panel opened; refreshing.' }
    }
    // Nothing can draw the pane here: print the list instead.
    await refresh($)
    const why = 'reason' in opened ? String(opened.reason).split(':')[0] : 'unknown'
    return { text: `${asText(await read($, snapshot), await $.clock.now())}\n_(panel unavailable here: ${why})_` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const s = await read($, snapshot)
    const now = await $.clock.now()

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1}>
          <Text dimColor>
            {s.isLoading
              ? 'Refreshing…'
              : s.refreshedAt
                ? `Updated ${laTime(s.refreshedAt)} PT · every 3 min`
                : 'Loading…'}
          </Text>
          <Button key="refresh" label="Refresh" onPress={() => refresh($)} />
        </Box>
        {s.errors.map(err => (
          <Text color="error">{err}</Text>
        ))}
        {s.refreshedAt !== null && s.rows.length === 0 && s.errors.length === 0 && (
          <Text dimColor>No open PRs.</Text>
        )}
        {REPOS.filter(repo => s.rows.some(r => r.repo === repo)).map(repo => (
          <Box flexDirection="column">
            <Text bold>{repo}</Text>
            {s.rows
              .filter(r => r.repo === repo)
              .map(r => (
                <Box flexDirection="column">
                  <Text>
                    <Link href={r.url}>#{r.number}</Link> {r.isDraft ? '(draft) ' : ''}
                    {r.title}
                  </Text>
                  <Text dimColor>{statusLine(r, now)}</Text>
                </Box>
              ))}
          </Box>
        ))}
      </Box>
    )
  })
}
