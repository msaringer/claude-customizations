import { expect, test } from 'claude-code/testing'

const NOW = Date.parse('2026-11-19T12:00:00Z')

const HINT = {
  plugin: 'usage-meter',
  component: 'PromptHint',
  props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
} as const

const USAGE = {
  startedAt: NOW - 3_600_000,
  context: { tokens: 115_000, window: 1_000_000, percent: 12 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 58, resetsAt: '2026-11-19T14:14:30Z' },
    { kind: 'seven_day', percentUsed: 69 },
  ],
  cost: { usd: 1.5 },
}

const GIT = [
  '# branch.oid 0123456789abcdef',
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +2 -0',
  '1 .M N... 100644 100644 100644 aaa bbb README.md',
  '? notes.txt',
  '',
].join('\n')

// Stand-ins for the engine beneath the mod.
const engine = (on: Parameters<Parameters<typeof test>[1]>[1], store: Record<string, unknown>) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'meter' } }))
  on('session.usage', () => ({ value: USAGE }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: undefined }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: GIT, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('store.get', (_, e) => ({ value: store[e.key] }))
  on('store.set', (_, e) => {
    store[e.key] = e.value
    return { value: undefined }
  })
}

test('the full row shows model, git, context, 5h countdown and cost', async ($, on) => {
  engine(on, { totalUsd: 30 })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...HINT, surface: 'terminal' })
  const text = async (re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text

  expect(await text(/Opus/)).toBe('Opus 5.5')
  expect(await text(/⎇/)).toBe('⎇ main')
  expect(await text(/±/)).toBe(' ±2')
  expect(await text(/↑/)).toBe(' ↑2')
  expect(await text(/%$/)).toBe(' 12%')
  expect(await text(/↺/)).toBe(' ↺2h14m')
  expect(await text(/~\$/)).toBe('~$1.50')
  expect(await text(/Σ/)).toBe(' Σ$30.0')
  await ui.unmount()
})

test('/meter cycles to compact, then off, and remembers it', async ($, on) => {
  const store: Record<string, unknown> = {}
  engine(on, store)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const first = await $.command.run({ command: 'meter', args: '' })
  expect(first.text).toBe('Usage meter: compact')
  expect(store.mode).toBe('compact')

  const ui = await $.ui.mount({ ...HINT, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Σ/ })).toBe(undefined)
  expect((await ui.find({ type: 'Text', text: /^12%$/ }))?.text).toBe('12%')
  await ui.unmount()

  const second = await $.command.run({ command: 'meter', args: 'off' })
  expect(second.text).toBe('Usage meter: off')
  const off = await $.ui.mount({ ...HINT, surface: 'terminal' })
  expect(await off.find({ type: 'Text', text: /ctx/ })).toBe(undefined)
  await off.unmount()

  const bad = await $.command.run({ command: 'meter', args: 'loud' })
  expect(bad.text).toBe('Usage: /meter [full|compact|off] (now: off)')
})
