import type { Register } from 'claude-code'

// The connector's name differs by where the session runs: cloud sessions see
// `MoBot_Brain`, local ones may see the claude.ai connector by its full name.
const SERVERS = ['MoBot_Brain', 'claude.ai MoBot Brain', 'MoBot Brain']
const KINDS = [
  'idea', 'thesis', 'decision', 'goal', 'commitment', 'person',
  'reference', 'document', 'note', 'fact', 'opinion',
] as const
type Kind = (typeof KINDS)[number]

// "/m idea: try X" → kind idea, text "try X". No prefix → saved as a note.
export function parse(args: string): { kind?: Kind; text: string } {
  const text = args.trim()
  const m = /^(\w+):\s*([\s\S]+)$/.exec(text)
  const kind = m?.[1].toLowerCase() as Kind | undefined
  if (m && kind && KINDS.includes(kind)) return { kind, text: m[2].trim() }
  return { text }
}

// The server answers with JSON carrying a human-readable `message`; show only that.
function message(said: string): string {
  try {
    const parsed: unknown = JSON.parse(said)
    if (parsed && typeof parsed === 'object' && 'message' in parsed && typeof parsed.message === 'string') {
      return parsed.message
    }
  } catch {
    // not JSON — show as is
  }
  return said
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'm',
      description: 'Save to MoBotBrain (prefix with idea:, decision:, commitment: … to set the kind)',
      argumentHint: '[kind:] text',
      immediate: true,
    })
    return next(e)
  })

  on('command.run', { command: 'm' }, async ($, e) => {
    const { kind, text } = parse(e.args)
    if (!text) {
      return { text: `Usage: /m [kind:] text — kinds: ${KINDS.join(', ')}` }
    }
    const args = kind ? { text, kind } : { text }
    let res: Awaited<ReturnType<typeof $.mcp.call>> | undefined
    let lastErr: unknown
    // A throw means the call didn't get a result (wrong name, not connected),
    // so move on to the next name.
    for (const server of SERVERS) {
      try {
        res = await $.mcp.call(server, 'brain_capture', args)
        break
      } catch (err) {
        lastErr = err
      }
    }
    if (!res) {
      const why = lastErr instanceof Error ? lastErr.message : String(lastErr)
      return { text: `Couldn't reach MoBotBrain. Is the MoBot Brain connector connected in this session? (${why})` }
    }
    const said = res.content
      .map(b => (b.type === 'text' ? b.text : ''))
      .filter(Boolean)
      .join('\n')
    if (res.isError) return { text: `MoBotBrain refused: ${message(said) || 'unknown error'}` }
    $.ui.toast(`Saved to MoBotBrain${kind ? ` as ${kind}` : ''}`)
    return { text: message(said) || `Saved${kind ? ` as ${kind}` : ' as note'}.` }
  })
}
