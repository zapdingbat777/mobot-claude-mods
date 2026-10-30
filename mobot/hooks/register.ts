import type { Register } from 'claude-code'

const SERVER = 'MoBot_Brain'
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
    try {
      const res = await $.mcp.call(SERVER, 'brain_capture', kind ? { text, kind } : { text })
      const said = res.content
        .map(b => (b.type === 'text' ? b.text : ''))
        .filter(Boolean)
        .join('\n')
      if (res.isError) return { text: `MoBotBrain refused: ${message(said) || 'unknown error'}` }
      $.ui.toast(`Saved to MoBotBrain${kind ? ` as ${kind}` : ''}`)
      return { text: message(said) || `Saved${kind ? ` as ${kind}` : ' as note'}.` }
    } catch (err) {
      return { text: `Couldn't reach MoBotBrain: ${err instanceof Error ? err.message : String(err)}` }
    }
  })
}
