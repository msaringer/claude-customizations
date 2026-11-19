# claude-customizations

Personal Claude Code mods, published as a plugin marketplace.

| Mod | What it does |
| --- | --- |
| [usage-meter](usage-meter/) | Coloured row under the prompt: model, git, context, tokens and cache hit rate, 5h reset countdown, turn and total cost |

## Install

At a Claude Code prompt:

```
/plugin install usage-meter --marketplace msaringer/claude-customizations
```

Answer `y` to add the marketplace, then pick a scope. Or from a shell:

```
claude plugin install usage-meter --marketplace msaringer/claude-customizations
```

This repository is private, so the machine needs git access to it (signed in with `gh`, or an SSH key on the account).

## Develop

To load a mod from a local clone for one session, without installing it:

```
claude --plugin-dir <path to clone>/usage-meter
```

After pushing a change, run `/plugin marketplace update claude-customizations` on each machine to pick it up.
