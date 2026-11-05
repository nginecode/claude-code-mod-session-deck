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

The panel opens automatically when a session starts. To open or focus it again, run
the slash command:

```
/session-deck
```

## Files

| File           | Purpose                                                              |
| -------------- | -------------------------------------------------------------------- |
| `plugin.json`  | Mod manifest: name, version, description, author, types entry.      |
| `hooks.json`   | Declares the hook modules to load (`./register.tsx`).                |
| `register.tsx` | All logic: state atom, hooks, command and panel rendering.           |
| `index.d.ts`   | `Deck` and `Git` state types and `PluginState` declaration for `session-deck`.  |

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
| `session.start`     | Starts a 1 s repaint timer, loads data, opens the panel, registers `/session-deck`.             |
| `command.run`       | Opens and focuses the panel for `/session-deck`.                                                |
| `turn.start`        | Marks the turn as running and records its start time. Sub-agent turns are ignored.              |
| `turn.complete`     | Clears running state, stores the last turn's duration and reason, refreshes data.               |
| `tool.call`         | Adds the tool to the running list and removes it when the call ends. Panel errors never block the tool call. |
| `session.measure`   | Refreshes usage data.                                                                           |
| `ui.render`         | Renders the `Pane` component.                                                                   |

The timer only invalidates the render; the elapsed time is computed while rendering.

## Installation

Place this folder where Claude Code loads mods from (the mod's `plugin.json` and
`hooks.json` must be at its root) and restart or reload Claude Code.

## Known issue

`plugin.json` points `types` to `./types/index.d.ts` and `register.tsx` imports
`../types`, but in this repository the type declarations live in the root `index.d.ts`.
Adjust the paths (or move the file into a `types/` folder) to match your layout.
