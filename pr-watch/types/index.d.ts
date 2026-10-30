export type Ci = 'passed' | 'failed' | 'running' | 'stuck' | 'none'
export type Codex = 'clean' | 'findings' | 'stale' | 'pending'

export type PrRow = {
  repo: string
  number: number
  title: string
  url: string
  isDraft: boolean
  ci: Ci
  failedChecks: string[]
  codex: Codex
  mergeState: string
  updatedAt: string
}

export type Snapshot = {
  rows: PrRow[]
  refreshedAt: number | null
  errors: string[]
  isLoading: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'pr-watch': { snapshot: Shaped<Snapshot> }
  }
}
