# claude-customizations

Personal Claude Code mods, set up as a local plugin marketplace.

| Mod | What it does |
| --- | --- |
| [usage-meter](usage-meter/) | Coloured row under the prompt: model, effort, context fill, tokens, rate limits and estimated cost |

## Install on another machine

Clone or sync this folder, then at a Claude Code prompt:

```
/plugin marketplace add ~/Dropbox/git/claude-customizations
/plugin install usage-meter@claude-customizations
```

Or, without installing, load it for one session:

```
claude --plugin-dir ~/Dropbox/git/claude-customizations/usage-meter
```

After editing a mod, run `/plugin marketplace update claude-customizations` to pick up the change.
