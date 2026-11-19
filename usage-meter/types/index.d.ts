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

declare module 'claude-code' {
  interface PluginState {
    'usage-meter': { tokens: Tokens; measure: Measure | null; model: ModelInfo | null }
  }
}
