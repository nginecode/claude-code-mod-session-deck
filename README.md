# session-deck

A Claude Code mod that adds a colorful **session panel** next to the chat. It shows
live session status and gives you one-key control buttons.

- **Version:** 0.1.0
- **Author:** nginecode

## Features

- **Turn status** – a yellow `WORKING 12.3s` badge with a live timer, or a green `IDLE` badge.
- **Session info** – model, number of turns, cost in USD (when available) and working directory.
- **Context usage** – a bar with percentage and `tokens / window` counts.
- **Rate limits** – one bar per limit window (`5h`, `7d`, other kinds are shown as-is).
- **Running tools** – the tools being executed right now (last 20 tracked), plus the
  duration and reason of the last completed turn.
- **Git control** – branch, ahead/behind counts, staged/modified/new file counts and
  Commit, Push, PR and Review buttons that ask Claude to do the git work.
- **Control buttons** – Stop, Compact, Refresh, each with a hotkey.
- **Status line** – a short note below the buttons with the result of the last action.

### Color thresholds

Context and rate-limit bars change color with usage:

| Usage    | Color  |
| -------- | ------ |
| < 60%    | green  |
| 60–84%   | yellow |
| ≥ 85%    | red    |

### Buttons

| Button  | Hotkey | Action                                                        |
| ------- | ------ | ------------------------------------------------------------- |
| Stop    | `s`    | Aborts the current turn (`turn.abort`).                       |
| Compact | `c`    | Compacts the context (`session.compact`). Refused mid-turn.   |
| Refresh | `r`    | Re-reads usage, model, cwd and turn count.                    |

### Git control

The Git section appears when the session directory is a git repository. It is refreshed
after every turn, on `session.measure` and on Refresh (it runs a single
`git status --porcelain=v1 -b`). The buttons do not run git themselves: each one submits
a prompt, so Claude performs the work under your normal permission rules.
Push and PR need a second press within 10 seconds, and the confirmation shows the
branch and upstream they will use.

| Button | Hotkey | Asks Claude to                                                              |
| ------ | ------ | --------------------------------------------------------------------------- |
| Commit | `m`    | Review the changes and commit them with a Conventional Commits message.     |
| Push   | `p`    | Push the current branch (sets upstream if missing, never force-pushes).     |
| PR     | `o`    | Push if needed and open a pull request with the `gh` CLI, then report URL.  |
| Review | `v`    | Review the uncommitted changes without modifying any files.                 |

The prompts live in `GIT_PROMPTS` in `register.tsx`; edit them to match your conventions.
They tell Claude not to add AI attribution trailers. The git buttons are refused while a
turn is running, and `gh` must be installed and authenticated for PR.

## Usage

The panel does not open on its own, so it never takes the place of Claude Code's default
panels. Open it with the slash command:

```
/session-deck
```

## Files

| File                              | Purpose                                                          |
| --------------------------------- | ---------------------------------------------------------------- |
| `.claude-plugin/plugin.json`      | Mod manifest: name, version, description, author, types entry.  |
| `.claude-plugin/marketplace.json` | Makes this repository an installable marketplace.                |
| `hooks/hooks.json`                | Declares the hook modules to load (`./register.tsx`).            |
| `hooks/register.tsx`              | All logic: state atom, hooks, command and panel rendering.       |
| `types/index.d.ts`                | `Deck` and `Git` state types and the `PluginState` declaration.  |

## How it works

All state lives in a single atom, `deck` (shape tag `deck-2`). Bump the tag whenever the
shape of `Deck` changes so that state saved by an older version is rejected.

### State (`Deck`)

| Field       | Description                                              |
| ----------- | -------------------------------------------------------- |
| `turnId`    | Id of the running turn, or `null` when idle.             |
| `startedAt` | Timestamp the current turn started.                      |
| `tools`     | Tools currently running (`{ id, tool }`, max 20).        |
| `turns`     | Number of turns in the session.                          |
| `last`      | Duration (`ms`) and `reason` of the last completed turn. |
| `model`     | Current model.                                           |
| `cwd`       | Working directory.                                       |
| `percent`   | Context usage in percent.                                |
| `tokens`    | Tokens currently in context.                             |
| `window`    | Context window size.                                     |
| `limits`    | Rate limits: `{ kind, percent }[]`.                      |
| `costUsd`   | Session cost in USD, or `null`.                          |
| `git`       | Branch, upstream, ahead/behind and file counts, or `null` outside a repository. |
| `note`      | Message shown under the buttons.                         |

### Hooks

| Hook                | What it does                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| `session.start`     | Starts a 1 s repaint timer, loads data, registers `/session-deck`.             |
| `command.run`       | Opens and focuses the panel for `/session-deck`.                                                |
| `turn.start`        | Marks the turn as running and records its start time. Sub-agent turns are ignored.              |
| `turn.complete`     | Clears running state, stores the last turn's duration and reason, refreshes data.               |
| `tool.call`         | Adds the tool to the running list and removes it when the call ends. Panel errors never block the tool call. |
| `session.measure`   | Refreshes usage data.                                                                           |
| `ui.render`         | Renders the `Pane` component.                                                                   |

The timer only invalidates the render; the elapsed time is computed while rendering.

## Installation

From GitHub, at the prompt of a terminal session:

```
/plugin install session-deck --marketplace nginecode/claude-code-mod-session-deck
```

Answer `y` to add the marketplace, then pick a scope. In the desktop app, where `/plugin`
does not run: click + next to the prompt box, then Plugins, Add marketplace with
`nginecode/claude-code-mod-session-deck`, then Add plugin.

### Local install (development)

Clone the repository, then either run a single session straight from the folder:

```bash
claude --plugin-dir /path/to/claude-code-mod-session-deck
```

or add the folder as a marketplace and install from it. The plugin is then read from the
folder itself, so after an edit `/reload-plugins` is enough:

```bash
claude plugin marketplace add /path/to/claude-code-mod-session-deck
claude plugin install session-deck@nginecode-mods
```

