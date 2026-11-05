export type Limit = { kind: string; percent: number }

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
  note: string
}

declare module 'claude-code' {
  interface PluginState {
    'session-deck': { deck: Shaped<Deck> }
  }
}
