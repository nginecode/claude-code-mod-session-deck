export type Limit = { kind: string; percent: number }

export type Git = {
  branch: string
  upstream: string | null
  ahead: number
  behind: number
  staged: number
  unstaged: number
  untracked: number
}

export type Deck = {
  turnId: string | null
  startedAt: number
  tools: { id: string; tool: string }[]
  turns: number
  last: { ms: number; reason: string } | null
  model: string
  cwd: string
  percent: number | null
  tokens: number | null
  window: number
  limits: Limit[]
  costUsd: number | null
  git: Git | null
  note: string
}

declare module 'claude-code' {
  interface PluginState {
    'session-deck': { deck: Shaped<Deck> }
  }
}
