import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, Register } from 'claude-code'

import type { Git, Measure, Mode, ModelInfo, Spend, Tokens } from '../types'

const ZERO: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0 }
const tokens = atom({ plugin: 'usage-meter', key: 'tokens' } as const, ZERO)
const measure = atom({ plugin: 'usage-meter', key: 'measure' } as const, null)
const model = atom({ plugin: 'usage-meter', key: 'model' } as const, null)
const spend = atom({ plugin: 'usage-meter', key: 'spend' } as const, null)
const git = atom({ plugin: 'usage-meter', key: 'git' } as const, null)
const mode = atom({ plugin: 'usage-meter', key: 'mode' } as const, 'full')
const now = atom({ plugin: 'usage-meter', key: 'now' } as const, 0)

const STORE_TOTAL = 'totalUsd'
const STORE_MODE = 'mode'
const MODES: readonly Mode[] = ['full', 'compact', 'off']
const TICK_MS = 30_000

const BAR_WIDTH = 10

// ---------- formatting ----------

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

// 2h14m, 14m, <1m; null once the reset time has passed
const countdown = (resetsAt: string | undefined, nowMs: number): string | null => {
  if (!resetsAt || nowMs === 0) return null
  const ms = Date.parse(resetsAt) - nowMs
  if (!Number.isFinite(ms) || ms <= 0) return null
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return '<1m'
  const h = Math.floor(mins / 60)
  return h > 0 ? `${h}h${String(mins % 60).padStart(2, '0')}m` : `${mins}m`
}

// ---------- colours ----------

// usage: green under 50%, amber under 80%, red from 80%
const level = (percent: number): Color =>
  percent >= 80 ? 'error' : percent >= 50 ? 'warning' : 'success'

// cost: green under $5, amber under $20, red from $20
const costLevel = (n: number): Color => (n >= 20 ? 'error' : n >= 5 ? 'warning' : 'success')

// cache hit rate: higher is better
const hitLevel = (percent: number): Color =>
  percent >= 80 ? 'success' : percent >= 50 ? 'warning' : 'error'

// ---------- data refreshers ----------

const refreshGit = async ($: EngineInterface): Promise<void> => {
  const cwd = await $.session.cwd()
  const r = await $.process.run(['git', 'status', '--porcelain=v2', '--branch'], {
    cwd,
    timeoutMs: 3_000,
  })
  if (r.exitCode !== 0) {
    await update($, git, () => null)
    return
  }
  let branch = ''
  let oid = ''
  let ahead = 0
  let behind = 0
  let changes = 0
  for (const line of r.stdout.split('\n')) {
    if (line.startsWith('# branch.head ')) branch = line.slice(14)
    else if (line.startsWith('# branch.oid ')) oid = line.slice(13)
    else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line)
      ahead = Number(m?.[1] ?? 0)
      behind = Number(m?.[2] ?? 0)
    } else if (line !== '' && !line.startsWith('#')) changes += 1
  }
  if (branch === '(detached)') branch = oid ? `@${oid.slice(0, 7)}` : 'detached'
  const g: Git = { branch, changes, ahead, behind }
  await update($, git, () => g)
}

const tick = async ($: EngineInterface): Promise<void> => {
  const t = await $.clock.now()
  await update($, now, () => t)
}

// Fold a new session cost reading into the last-turn and cross-session figures.
const recordCost = async ($: EngineInterface, cost: number): Promise<void> => {
  const s = await read($, spend)
  if (s === null) return
  const delta = cost - s.lastSeen
  let total = s.total
  if (delta > 0) {
    // re-read the store so parallel sessions don't overwrite each other's adds
    total = Number((await $.store.get(STORE_TOTAL)) ?? 0) + delta
    await $.store.set(STORE_TOTAL, total)
  }
  const next: Spend = {
    lastSeen: cost, // also follows a drop (a /clear)
    turnStart: s.turnStart,
    lastTurn: s.turnStart === null ? s.lastTurn : Math.max(0, cost - s.turnStart),
    total,
  }
  await update($, spend, () => next)
}

// ---------- hooks ----------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    $.ui.status(undefined) // the old plain status line, replaced by the row below

    await $.command.register({
      name: 'meter',
      description: 'Usage meter: cycle full / compact / off, or name one',
      argumentHint: '[full|compact|off]',
      immediate: true,
    })

    const storedMode = await $.store.get(STORE_MODE)
    if (MODES.includes(storedMode as Mode)) {
      await update($, mode, () => storedMode as Mode)
    }

    const u = await $.session.usage()
    const name = await $.session.model()
    const total = Number((await $.store.get(STORE_TOTAL)) ?? 0)
    const cost = u.cost?.usd ?? 0
    await update($, measure, () => ({
      context: { tokens: u.context.tokens, window: u.context.window, percent: u.context.percent },
      rateLimits: u.rateLimits,
      cost: u.cost,
    }))
    await update($, model, (prev): ModelInfo => ({ name, effort: prev?.effort }))
    // A fresh session starts at $0; a resumed one at what it already cost,
    // which an earlier run already added to the total. A reload keeps its own.
    await update($, spend, (prev): Spend =>
      prev === null
        ? { lastSeen: cost, turnStart: null, lastTurn: null, total }
        : { ...prev, total },
    )

    await tick($)
    await refreshGit($)
    $.clock.every(TICK_MS, () => {
      void tick($)
      void refreshGit($)
    })

    return result
  })

  on('command.run', { command: 'meter' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const current = await read($, mode)
    let target: Mode
    if (arg === '') {
      target = MODES[(MODES.indexOf(current) + 1) % MODES.length] ?? 'full'
    } else if (MODES.includes(arg as Mode)) {
      target = arg as Mode
    } else {
      return { text: `Usage: /meter [full|compact|off] (now: ${current})` }
    }
    await update($, mode, () => target)
    await $.store.set(STORE_MODE, target)
    return { text: `Usage meter: ${target}` }
  })

  // Remember the session's cost when a main-thread turn begins.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const cost = (await $.session.usage()).cost?.usd ?? 0
      await update($, spend, (s): Spend =>
        s === null
          ? { lastSeen: cost, turnStart: cost, lastTurn: null, total: 0 }
          : { ...s, turnStart: cost },
      )
    }
    return next(e)
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

  // Tools that may change files or switch branches: re-read git afterwards.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const result = await next(e)
    void refreshGit($)
    return result
  }).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const result = await next(e)
    void refreshGit($)
    return result
  }).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const result = await next(e)
    void refreshGit($)
    return result
  }).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const result = await next(e)
    void refreshGit($)
    return result
  }).catch(($, e, next) => next(e))

  // The engine pushes fresh context / rate-limit / cost figures here (after
  // each turn), which also catches a /model switch made between turns.
  on('session.measure', async ($, e, next) => {
    const m: Measure = {
      context: { tokens: e.context.tokens, window: e.context.window, percent: e.context.percent },
      rateLimits: e.rateLimits,
      cost: e.cost,
    }
    await update($, measure, () => m)
    if (e.cost) {
      await recordCost($, e.cost.usd)
    }
    const name = await $.session.model()
    await update($, model, (prev): ModelInfo => ({ name, effort: prev?.effort }))
    await tick($)
    return next(e)
  })

  // Draw the meter as a coloured, wrapping row under the prompt's hint line.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const hint = await next(e)
    const view = await read($, mode)
    const m = await read($, measure)
    if (view === 'off' || m === null) {
      return hint
    }
    const t = await read($, tokens)
    const mi = await read($, model)
    const s = await read($, spend)
    const g = await read($, git)
    const nowMs = await read($, now)
    const { Box, Text } = $.ui.resolve(e)

    const isFull = view === 'full'
    const pct = m.context.percent ?? 0
    const filled = Math.max(0, Math.min(BAR_WIDTH, Math.round((pct / 100) * BAR_WIDTH)))
    const used = m.context.tokens !== undefined ? fmt(m.context.tokens) : '–'
    const allIn = t.input + t.cacheRead + t.cacheWrite
    const hit = allIn > 0 ? Math.round((t.cacheRead / allIn) * 100) : 0
    const fiveHour = m.rateLimits.find(r => r.kind === 'five_hour')
    const others = isFull ? m.rateLimits.filter(r => r.kind !== 'five_hour') : []
    const reset = countdown(fiveHour?.resetsAt, nowMs)

    return (
      <Box flexDirection="column">
        {hint}
        <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
          {mi ? (
            <Box flexDirection="row">
              <Text color="claude" bold>{prettyModel(mi.name)}</Text>
              {isFull && mi.effort ? <Text dimColor>{` · ${mi.effort}`}</Text> : null}
            </Box>
          ) : null}

          {g ? (
            <Box flexDirection="row">
              <Text color={g.changes > 0 ? 'warning' : 'success'}>{`⎇ ${g.branch}`}</Text>
              {g.changes > 0 ? <Text color="warning">{` ±${g.changes}`}</Text> : null}
              {g.ahead > 0 ? <Text color="suggestion">{` ↑${g.ahead}`}</Text> : null}
              {g.behind > 0 ? <Text color="suggestion">{` ↓${g.behind}`}</Text> : null}
            </Box>
          ) : null}

          <Box flexDirection="row">
            <Text dimColor>ctx </Text>
            {isFull ? <Text color={level(pct)}>{'█'.repeat(filled)}</Text> : null}
            {isFull ? <Text dimColor>{'░'.repeat(BAR_WIDTH - filled)}</Text> : null}
            <Text color={level(pct)} bold>{isFull ? ` ${pct}%` : `${pct}%`}</Text>
            {isFull ? <Text dimColor>{` ${used}/${fmt(m.context.window)}`}</Text> : null}
          </Box>

          {isFull && t.requests > 0 ? (
            <Box flexDirection="row">
              <Text dimColor>in </Text>
              <Text color="suggestion">{fmt(allIn)}</Text>
              <Text dimColor> chd </Text>
              <Text color={hitLevel(hit)}>{`${hit}%`}</Text>
              <Text dimColor> out </Text>
              <Text color="suggestion">{fmt(t.output)}</Text>
            </Box>
          ) : null}

          {fiveHour || others.length > 0 ? (
            <Box flexDirection="row" columnGap={1}>
              {fiveHour ? (
                <Box flexDirection="row" key="five_hour">
                  <Text dimColor>5h </Text>
                  <Text color={level(fiveHour.percentUsed)}>{`${Math.round(fiveHour.percentUsed)}%`}</Text>
                  {reset ? <Text dimColor>{` ↺${reset}`}</Text> : null}
                </Box>
              ) : null}
              {others.map(r => (
                <Box flexDirection="row" key={r.kind}>
                  <Text dimColor>{`${r.kind === 'seven_day' ? '7d' : r.kind === 'spend_limit' ? 'spend' : r.kind} `}</Text>
                  <Text color={level(r.percentUsed)}>{`${Math.round(r.percentUsed)}%`}</Text>
                </Box>
              ))}
            </Box>
          ) : null}

          {m.cost ? (
            <Box flexDirection="row">
              <Text color={costLevel(m.cost.usd)} bold>{`~${usd(m.cost.usd)}`}</Text>
              {s?.lastTurn !== null && s?.lastTurn !== undefined ? (
                <Text dimColor>{` (+${usd(s.lastTurn)})`}</Text>
              ) : null}
              {isFull && s ? <Text dimColor>{` Σ${usd(s.total)}`}</Text> : null}
              <Text dimColor>{m.cost.hasUnknownPrice ? ' est.*' : ' est.'}</Text>
            </Box>
          ) : null}
        </Box>
      </Box>
    )
  })
}
