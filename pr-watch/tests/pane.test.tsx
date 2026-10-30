import { expect, test } from 'claude-code/testing'

import { summarizeCi, summarizeCodex } from '../hooks/register'

const PANE = {
  plugin: 'pr-watch',
  component: 'Pane',
  requestId: 'pr-watch',
  props: {
    title: 'Pull requests',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const HEAD = 'abc123'
const NOW = Date.parse('2026-10-30T20:00:00Z')

// Synthetic GitHub answers: one open PR on Quinn-HOA, none elsewhere.
function github(tool: string, args: Record<string, unknown>): unknown {
  if (tool === 'list_pull_requests') {
    if (args.repo !== 'Quinn-HOA') return []
    return [
      {
        number: 42,
        title: 'Add widget',
        draft: false,
        html_url: 'https://github.com/zapdingbat777/Quinn-HOA/pull/42',
        head: { sha: HEAD },
        updated_at: '2026-10-30T18:00:00Z',
      },
    ]
  }
  if (tool === 'issue_read') return { reactions: { '+1': 1 } }
  if (args.method === 'get') return { head: { sha: HEAD }, mergeable_state: 'clean' }
  if (args.method === 'get_check_runs') {
    return {
      check_runs: [
        { name: 'test-and-build', status: 'completed', conclusion: 'success' },
        { name: 'codex', status: 'completed', conclusion: 'skipped' },
      ],
    }
  }
  if (args.method === 'get_reviews') return []
  throw new Error(`unexpected ${tool}`)
}

test('the pane lists an open PR with its CI, Codex and merge state', async ($, on) => {
  on('command.register', () => ({ value: { command: 'prs' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.close', () => ({ value: undefined }))
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: undefined }))
  on('mcp.call', (_, e) => {
    if (e.server !== 'github') throw new Error('no such server')
    return { value: { content: [{ type: 'text', text: JSON.stringify(github(e.tool, e.args)) }], isError: false } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // The test kit's $ types the raw event; the engine fills origin and presentation.
  await $.command.run({ command: 'prs', args: '' } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const status = await ui.find({ type: 'Text', text: /CI/ })
    expect(status?.text).toBe('✅ CI · 👍 Codex · mergeable · 2h ago')
    expect((await ui.find({ type: 'Text', text: /Add widget/ }))?.text).toContain('#42')
    await ui.unmount()
  }
})

test('CI: a failure wins, then a run waiting for approval, then running', () => {
  const ok = { name: 'test-and-build', status: 'completed', conclusion: 'success' }
  expect(summarizeCi([ok, { name: 'lint', status: 'completed', conclusion: 'failure' }])).toEqual({
    ci: 'failed',
    failedChecks: ['lint'],
  })
  expect(summarizeCi([ok, { name: 'e2e', status: 'completed', conclusion: 'action_required' }]).ci).toBe('stuck')
  expect(summarizeCi([ok, { name: 'e2e', status: 'in_progress', conclusion: null }]).ci).toBe('running')
  expect(summarizeCi([{ name: 'codex', status: 'completed', conclusion: 'skipped' }]).ci).toBe('none')
})

test('Codex: findings on HEAD, a 👍, or a review of an older commit', () => {
  const codex = (commit_id: string) => ({ user: { login: 'chatgpt-codex-connector[bot]' }, commit_id })
  expect(summarizeCodex([codex(HEAD)], 0, HEAD)).toBe('findings')
  expect(summarizeCodex([codex('old')], 1, HEAD)).toBe('clean')
  expect(summarizeCodex([codex('old')], 0, HEAD)).toBe('stale')
  expect(summarizeCodex([], 0, HEAD)).toBe('pending')
})

test('with no surface to draw on, /prs prints the list instead', async ($, on) => {
  on('command.register', () => ({ value: { command: 'prs' } }))
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'no-surface: no surface is attached' } }))
  on('ui.panes', () => ({ value: [] }))
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: undefined }))
  on('mcp.call', (_, e) => ({
    value: { content: [{ type: 'text', text: JSON.stringify(github(e.tool, e.args)) }], isError: false },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // The test kit's $ types the raw event; the engine fills origin and presentation.
  const { text } = await $.command.run({ command: 'prs', args: '' } as never)
  expect(text).toContain('[#42](https://github.com/zapdingbat777/Quinn-HOA/pull/42) Add widget')
  expect(text).toContain('✅ CI · 👍 Codex · mergeable · 2h ago')
  expect(text).toContain('panel unavailable here: no-surface')
})
