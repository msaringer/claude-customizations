import { atom, read, update } from 'claude-code'
import type { Color, Register } from 'claude-code'

import type { Measure, ModelInfo, Tokens } from '../types'

const ZERO: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0 }
const tokens = atom({ plugin: 'usage-meter', key: 'tokens' } as const, ZERO)
const measure = atom({ plugin: 'usage-meter', key: 'measure' } as const, null)
const model = atom({ plugin: 'usage-meter', key: 'model' } as const, null)

const BAR_WIDTH = 10
const LIMIT_NAMES: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }

const fmt = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}k`
  return String(n)
}

const usd = (n: number): string => (n < 10 ? `$${n.toFixed(2)}` : `$${n.toFixed(1)}`)

// claude-opus-5-5[1m] -> Opus 5.5 [1m]; anything else (an alias, a gateway id) as given
const prettyModel = (id: string): string => {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)(?:-\d{8})?(\[.*\])?$/.exec(id)
  if (!m || !m[1]) return id
  const family = m[1].charAt(0).toUpperCase() + m[1].slice(1)
  return `${family} ${m[2]}.${m[3]}${m[4] ? ` ${m[4]}` : ''}`
}

// green under 50%, amber under 80%, red from 80%
const level = (percent: number): Color =>
  percent >= 80 ? 'error' : percent >= 50 ? 'warning' : 'success'

// green under $5, amber under $20, red from $20
const costLevel = (n: number): Color => (n >= 20 ? 'error' : n >= 5 ? 'warning' : 'success')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    $.ui.status(undefined) // the old plain status line, replaced by the row below
    const u = await $.session.usage()
    const name = await $.session.model()
    await update($, measure, () => ({
      context: { tokens: u.context.tokens, window: u.context.window, percent: u.context.percent },
      rateLimits: u.rateLimits,
      cost: u.cost,
    }))
    await update($, model, (prev): ModelInfo => ({ name, effort: prev?.effort }))
    return result
  })

  // Sum every model response's token counts (main thread and subagents);
  // the main thread's request also says which model and effort are live.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      const name = await $.session.model()
      const effort = e.effort === undefined ? undefined : String(e.effort)
      await update($, model, (): ModelInfo => ({ name, effort }))
    }
    const result = yield* next(e)
    const u = result.usage
    if (u) {
      await update($, tokens, t => ({
        input: t.input + u.input_tokens,
        output: t.output + u.output_tokens,
        cacheRead: t.cacheRead + u.cache_read_input_tokens,
        cacheWrite: t.cacheWrite + u.cache_creation_input_tokens,
        requests: t.requests + 1,
      }))
    }
    return result
  })

  // The engine pushes fresh context / rate-limit / cost figures here (after
  // each turn), which also catches a /model switch made between turns.
  on('session.measure', async ($, e, next) => {
    const m: Measure = {
      context: { tokens: e.context.tokens, window: e.context.window, percent: e.context.percent },
      rateLimits: e.rateLimits,
      cost: e.cost,
    }
    await update($, measure, () => m)
    const name = await $.session.model()
    await update($, model, (prev): ModelInfo => ({ name, effort: prev?.effort }))
    return next(e)
  })

  // Draw the meter as a coloured, wrapping row under the prompt's hint line.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const hint = await next(e)
    const m = await read($, measure)
    if (m === null) {
      return hint
    }
    const t = await read($, tokens)
    const mi = await read($, model)
    const { Box, Text } = $.ui.resolve(e)

    const pct = m.context.percent ?? 0
    const filled = Math.max(0, Math.min(BAR_WIDTH, Math.round((pct / 100) * BAR_WIDTH)))
    const used = m.context.tokens !== undefined ? fmt(m.context.tokens) : '–'

    return (
      <Box flexDirection="column">
        {hint}
        <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
          {mi ? (
            <Box flexDirection="row">
              <Text color="claude" bold>{prettyModel(mi.name)}</Text>
              {mi.effort ? <Text dimColor>{` · ${mi.effort}`}</Text> : null}
            </Box>
          ) : null}

          <Box flexDirection="row">
            <Text dimColor>ctx </Text>
            <Text color={level(pct)}>{'█'.repeat(filled)}</Text>
            <Text dimColor>{'░'.repeat(BAR_WIDTH - filled)}</Text>
            <Text color={level(pct)} bold>{` ${pct}%`}</Text>
            <Text dimColor>{` ${used}/${fmt(m.context.window)}`}</Text>
          </Box>

          {t.requests > 0 ? (
            <Box flexDirection="row">
              <Text dimColor>in </Text>
              <Text color="suggestion">{fmt(t.input + t.cacheRead + t.cacheWrite)}</Text>
              <Text dimColor> chd </Text>
              <Text color="permission">{fmt(t.cacheRead)}</Text>
              <Text dimColor> out </Text>
              <Text color="suggestion">{fmt(t.output)}</Text>
            </Box>
          ) : null}

          {m.rateLimits.length > 0 ? (
            <Box flexDirection="row" columnGap={1}>
              {m.rateLimits.map(r => (
                <Box flexDirection="row" key={r.kind}>
                  <Text dimColor>{`${LIMIT_NAMES[r.kind] ?? r.kind} `}</Text>
                  <Text color={level(r.percentUsed)}>{`${Math.round(r.percentUsed)}%`}</Text>
                </Box>
              ))}
            </Box>
          ) : null}

          {m.cost ? (
            <Box flexDirection="row">
              <Text color={costLevel(m.cost.usd)} bold>{`~${usd(m.cost.usd)}`}</Text>
              <Text dimColor>{m.cost.hasUnknownPrice ? ' est.*' : ' est.'}</Text>
            </Box>
          ) : null}
        </Box>
      </Box>
    )
  })
}
