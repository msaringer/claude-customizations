# usage-meter

A Claude Code mod that draws a coloured row under the prompt's hint line:

```
Opus 5.5 · high   ctx ██░░░░░░░░ 12% 115k/1.0M   in 1.4M chd 1.4M out 7.6k   5h 58% 7d 69%   ~$1.53 est.
```

- **Model · effort**: the main loop's model as `/model` shows it, and the effort level of its last request
- **ctx**: context window fill: bar, percentage, tokens used / window size
- **in / chd / out**: input tokens (all of them), the cached share of input, and output tokens, summed over every model response this session, subagents included
- **5h / 7d**: subscription rate-limit windows, when the API reports them
- **~$ est.**: the client-side estimate `/cost` shows (list price, not your bill; `*` means a model without a known price was priced at another's rates)

Colours: context and rate limits are green below 50%, amber from 50%, red from 80%. Cost is green below $5, amber from $5, red from $20.

The row wraps between groups on narrow terminals. It refreshes on every model response and whenever the engine re-measures the session.

## Install

See the repository README.
