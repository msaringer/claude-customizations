# usage-meter

A Claude Code mod that draws a coloured row under the prompt's hint line:

```
Opus 5.5 · high   ⎇ main ±2 ↑1   ctx ██░░░░░░░░ 12% 115k/1.0M   in 1.4M chd 94% out 7.6k   5h 58% ↺2h14m 7d 69%   ~$1.53 (+$0.18) Σ$31.20 est.
```

- **Model · effort**: the main loop's model as `/model` shows it, and the effort level of its last request
- **⎇ branch**: the git branch of the session's folder; `±n` uncommitted changes, `↑n`/`↓n` commits ahead of / behind upstream. Green when clean, amber when dirty
- **ctx**: context window fill: bar, percentage, tokens used / window size
- **in / chd / out**: all input tokens, the cache hit rate (cached share of input), and output tokens, summed over every model response this session, subagents included
- **5h / 7d**: subscription usage limits, with the time until the 5-hour window resets
- **~$ (+$) Σ$ est.**: the session's estimated cost (as `/cost` shows it), what the last turn cost, and the running total across every session on this machine. List-price estimates, not your bill; `*` means a model without a known price was priced at another's rates

Colours: context and usage limits are green below 50%, amber from 50%, red from 80%. Cost is green below $5, amber from $5, red from $20. Cache hit rate is green from 80%, amber from 50%, red below.

The row wraps between groups on narrow terminals. It refreshes on every model response, after file-changing tool calls, and every 30 seconds.

## /meter

- `/meter`: cycle full → compact → off
- `/meter full|compact|off`: pick one

Compact shows just model, branch, context %, usage limits and cost. The choice is remembered across sessions.

## Install

See the repository README.
