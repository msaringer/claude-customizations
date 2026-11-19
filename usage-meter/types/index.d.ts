export type Tokens = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  requests: number
}

export type Measure = {
  context: { tokens?: number; window: number; percent?: number }
  rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[]
  cost?: { usd: number; hasUnknownPrice?: true }
}

export type ModelInfo = { name: string; effort?: string }

export type Spend = {
  /** The session cost last added to the cross-session total. */
  lastSeen: number
  /** The session cost when the current main-thread turn started. */
  turnStart: number | null
  /** What the last main-thread turn cost. */
  lastTurn: number | null
  /** Every session's cost added up, as of the last write to $.store. */
  total: number
}

export type Git = {
  branch: string
  changes: number
  ahead: number
  behind: number
}

export type Mode = 'full' | 'compact' | 'off'

declare module 'claude-code' {
  interface PluginState {
    'usage-meter': {
      tokens: Tokens
      measure: Measure | null
      model: ModelInfo | null
      spend: Spend | null
      git: Git | null
      mode: Mode
      now: number
    }
  }
}
