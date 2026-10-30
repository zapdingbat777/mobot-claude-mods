# mobot-claude-mods

Mo's Claude Code mods, as a plugin marketplace. Each folder is one mod you can install on its own.

| Mod | What it does |
| --- | --- |
| `mobot` | `/m <text>` saves straight into MoBotBrain, with no model turn. Start with a kind to set it: `/m idea: …`, `/m commitment: …`, `/m decision: …`. Without one it's saved as a note. Needs the MoBot Brain MCP connector to be connected in the session. |

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install mobot --marketplace zapdingbat777/mobot-claude-mods
```

From a shell:

```
claude plugin install mobot --marketplace zapdingbat777/mobot-claude-mods
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins → Add marketplace** with `zapdingbat777/mobot-claude-mods`, then **Add plugin**.

This repo is private: installing needs a machine with a git credential for github.com (an SSH key, or `gh auth login` then `gh auth setup-git`).

## Adding a mod

Add a folder with `.claude-plugin/plugin.json` and `hooks/`, then add an entry for it under `plugins` in `.claude-plugin/marketplace.json`.
