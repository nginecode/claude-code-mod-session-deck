import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { Deck } from '../types'

type Api = Parameters<Hook<'session.start'>>[0]

const PANE = 'session-deck'

const EMPTY: Deck = {
  turnId: null,
  startedAt: 0,
  tools: [],
  turns: 0,
  last: null,
  model: '',
  cwd: '',
  percent: null,
  tokens: null,
  window: 0,
  limits: [],
  costUsd: null,
  git: null,
  note: '',
}

// Change the tag whenever the shape of Deck changes: it rejects state saved by an older version.
const deck = atom({ plugin: 'session-deck', key: 'deck' } as const, EMPTY, {
  shape: 'deck-2',
})

// Prompts the git buttons submit. Claude does the actual git work, so the
// normal permission flow and the user's own commit conventions still apply.
const GIT_PROMPTS = {
  commit:
    'Review the current working tree changes with git status and git diff, then commit them with a sensible Conventional Commits message. Stage only files relevant to the changes. Do not push. Do not add any Co-Authored-By or other AI attribution trailer.',
  push: 'Push the current branch to its remote. Set the upstream if it is not set yet. Never force-push.',
  pr: 'Create a pull request for the current branch with the gh CLI: push the branch if needed, write a clear title and a description summarizing the commits, and report the PR URL. Do not add AI attribution.',
  review:
    'Review the uncommitted changes in the working tree (git diff and git status). Report bugs, risky changes and anything missing, but do not modify any files.',
} as const

type GitAction = keyof typeof GIT_PROMPTS

// Outbound actions need a second press within this window.
const CONFIRM_MS = 10_000
const OUTBOUND = new Set<GitAction>(['push', 'pr'])
let armed: { action: GitAction; at: number } | null = null

// Parses `git status --porcelain=v1 -b` output into the Git summary.
const parseGit = (out: string) => {
  const lines = out.split('\n').filter(l => l !== '')
  const head = lines.find(l => l.startsWith('## ')) ?? ''
  const rest = head.slice(3)
  const info = /^(.*?)(?:\.\.\.(\S+))?(?: \[(.*)\])?$/.exec(rest)
  const branch = (info?.[1] ?? rest).replace(/^No commits yet on /, '') || 'HEAD'
  const track = info?.[3] ?? ''
  const ahead = Number(/ahead (\d+)/.exec(track)?.[1] ?? 0)
  const behind = Number(/behind (\d+)/.exec(track)?.[1] ?? 0)
  let staged = 0
  let unstaged = 0
  let untracked = 0
  for (const l of lines) {
    if (l.startsWith('## ')) continue
    if (l.startsWith('??')) untracked++
    else {
      if (l[0] !== ' ') staged++
      if (l[1] !== ' ') unstaged++
    }
  }

  return { branch, upstream: info?.[2] ?? null, ahead, behind, staged, unstaged, untracked }
}

const tone = (p: number) => (p >= 85 ? 'red' : p >= 60 ? 'yellow' : 'green')

const bar = (p: number, width: number) => {
  const n = Math.round((Math.min(100, Math.max(0, p)) / 100) * width)
  return '█'.repeat(n) + '░'.repeat(width - n)
}

const secs = (ms: number) =>
  ms < 60_000
    ? `${(ms / 1000).toFixed(1)}s`
    : `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`

const kilo = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n))

const windowName = (kind: string) =>
  kind === 'five_hour' ? '5h' : kind === 'seven_day' ? '7d' : kind

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

async function refresh($: Api) {
  const [usage, model, cwd, turns] = await Promise.all([
    $.session.usage(),
    $.session.model(),
    $.session.cwd(),
    $.session.turns(),
  ])
  // Not a repository, or git is missing: the Git section just hides.
  const git = await $.process
    .run(
      [
        'git',
        '-c',
        'core.fsmonitor=false',
        '--no-optional-locks',
        'status',
        '--porcelain=v1',
        '-b',
      ],
      { cwd, env: { GIT_OPTIONAL_LOCKS: '0' }, timeoutMs: 5000 },
    )
    .then(r => (r.exitCode === 0 ? parseGit(r.stdout) : null))
    .catch(() => null)
  await update($, deck, d => ({
    ...d,
    git,
    model,
    cwd,
    turns,
    percent: usage.context.percent ?? null,
    tokens: usage.context.tokens ?? null,
    window: usage.context.window,
    limits: usage.rateLimits.map(r => ({ kind: r.kind, percent: r.percentUsed })),
    costUsd: usage.cost?.usd ?? null,
  }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // The timer only requests a repaint: the turn duration counter
    // is computed at render time.
    $.clock.every(1000, () => $.ui.invalidate('ui.render'))
    await refresh($)
    await $.command.register({
      name: 'session-deck',
      description: 'Open the session panel with control buttons',
    })

    return next(e)
  })

  on('command.run', { command: 'session-deck' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Session' })

    return {}
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      const startedAt = await $.clock.now()
      await update($, deck, d => ({ ...d, turnId: e.turnId, startedAt, note: '' }))
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (!e.agentId) {
      await update($, deck, d => ({
        ...d,
        turnId: null,
        startedAt: 0,
        tools: [],
        last: { ms: e.durationMs, reason: e.reason },
      }))
      await refresh($)
    }

    return done
  })

  on('tool.call', async ($, e, next) => {
    const id = e.tool_use_id
    // A panel failure must not block the tool call.
    await update($, deck, d => ({
      ...d,
      tools: [...d.tools, { id, tool: e.tool }].slice(-20),
    })).catch(() => undefined)
    try {
      return await next(e)
    } finally {
      await update($, deck, d => ({
        ...d,
        tools: d.tools.filter(t => t.id !== id),
      })).catch(() => undefined)
    }
  })

  on('session.measure', async ($, e, next) => {
    await refresh($)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const d = await read($, deck)
    const now = await $.clock.now()
    const width = Math.max(8, Math.min(28, (e.props.bodyColumns ?? 40) - 24))
    const working = d.turnId !== null
    const ctx = d.percent ?? 0

    const note = (text: string) => update($, deck, s => ({ ...s, note: text }))

    const stop = async () => {
      const cur = await read($, deck)
      if (!cur.turnId) return note('No turn to stop')
      try {
        await $.turn.abort({ turnId: cur.turnId })
        await note('Turn stopped')
      } catch (err) {
        await note('Failed to stop: ' + message(err))
      }
    }

    const compact = async () => {
      const cur = await read($, deck)
      if (cur.turnId) return note('Stop the current turn first')
      try {
        await $.session.compact()
        await refresh($)
        await note('Context compacted')
      } catch (err) {
        await note('Failed to compact: ' + message(err))
      }
    }

    const gitAction = (action: GitAction, label: string) => async () => {
      const cur = await read($, deck)
      if (cur.turnId) return note('Wait for the current turn to finish')
      const target = cur.git
        ? `${cur.git.branch} -> ${cur.git.upstream ?? 'a new upstream branch'}`
        : 'the current branch'
      if (OUTBOUND.has(action)) {
        const t = await $.clock.now()
        if (!armed || armed.action !== action || t - armed.at > CONFIRM_MS) {
          armed = { action, at: t }

          return note(`Press ${label} again within 10s to confirm (${target})`)
        }
        armed = null
      }
      const text = OUTBOUND.has(action)
        ? `${GIT_PROMPTS[action]} The branch and remote are: ${target}. Stop and ask if the repository state differs.`
        : GIT_PROMPTS[action]
      // Submitted without awaiting: it resolves with the turn it starts.
      $.prompt.submit({ text }).catch(err => note('Failed to ask Claude: ' + message(err)))
      await note('Asked Claude to ' + label)
    }

    const reload = async () => {
      try {
        await refresh($)
        await note('Refreshed')
      } catch (err) {
        await note('Failed to refresh: ' + message(err))
      }
    }

    return (
      <Box flexDirection="column" rowGap={1}>
        <Box flexDirection="row" columnGap={2}>
          <Text bold color="magenta">
            ◆ SESSION
          </Text>
          {working ? (
            <Text inverse bold color="yellow">
              {' '}
              WORKING {secs(Math.max(0, now - d.startedAt))}{' '}
            </Text>
          ) : (
            <Text inverse bold color="green">
              {' '}
              IDLE{' '}
            </Text>
          )}
        </Box>

        <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
          <Box flexDirection="row" columnGap={2}>
            <Text bold color="cyan">
              {d.model || '—'}
            </Text>
            <Text color="blue">turns: {d.turns}</Text>
            {d.costUsd !== null && <Text color="yellow">${d.costUsd.toFixed(2)}</Text>}
          </Box>
          <Text dimColor wrap="truncate-end">
            {d.cwd || '—'}
          </Text>
        </Box>

        <Box flexDirection="column" borderStyle="round" borderColor={tone(ctx)} paddingX={1}>
          <Box flexDirection="row" columnGap={1}>
            <Text bold>context</Text>
            <Text color={tone(ctx)}>{bar(ctx, width)}</Text>
            <Text bold color={tone(ctx)}>
              {d.percent === null ? '—' : d.percent + '%'}
            </Text>
          </Box>
          {d.tokens !== null && d.window > 0 && (
            <Text dimColor>
              {kilo(d.tokens)} / {kilo(d.window)} tokens
            </Text>
          )}
          {d.limits.map(l => (
            <Box flexDirection="row" columnGap={1}>
              <Text bold>{windowName(l.kind)}</Text>
              <Text color={tone(l.percent)}>{bar(l.percent, width)}</Text>
              <Text color={tone(l.percent)}>{l.percent}%</Text>
            </Box>
          ))}
        </Box>

        <Box flexDirection="column" borderStyle="round" borderColor="blue" paddingX={1}>
          {d.tools.length > 0 ? (
            <Text color="cyan">⚙ {d.tools.map(t => t.tool).join(', ')}</Text>
          ) : (
            <Text dimColor>no tools running</Text>
          )}
          {d.last && (
            <Text dimColor>
              last turn: {secs(d.last.ms)}, {d.last.reason}
            </Text>
          )}
        </Box>

        {d.git && (
          <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1}>
            <Box flexDirection="row" columnGap={2}>
              <Text bold color="magenta">
                ⎇ {d.git.branch}
              </Text>
              {d.git.upstream === null ? (
                <Text dimColor>no upstream</Text>
              ) : (
                <Text color={d.git.ahead + d.git.behind > 0 ? 'yellow' : 'green'}>
                  ↑{d.git.ahead} ↓{d.git.behind}
                </Text>
              )}
            </Box>
            {d.git.staged + d.git.unstaged + d.git.untracked === 0 ? (
              <Text color="green">working tree clean</Text>
            ) : (
              <Box flexDirection="row" columnGap={2}>
                <Text color="green">+{d.git.staged} staged</Text>
                <Text color="yellow">~{d.git.unstaged} modified</Text>
                <Text color="red">?{d.git.untracked} new</Text>
              </Box>
            )}
            <Box flexDirection="row" columnGap={1} rowGap={1} flexWrap="wrap">
              <Button key="commit" label="Commit" hotkey="m" onPress={gitAction('commit', 'commit')} />
              <Button key="push" label="Push" hotkey="p" onPress={gitAction('push', 'Push')} />
              <Button key="pr" label="PR" hotkey="o" onPress={gitAction('pr', 'PR')} />
              <Button key="review" label="Review" hotkey="v" onPress={gitAction('review', 'review changes')} />
            </Box>
          </Box>
        )}

        <Box flexDirection="row" columnGap={1} rowGap={1} flexWrap="wrap">
          <Button key="stop" label="Stop" hotkey="s" onPress={stop} />
          <Button key="compact" label="Compact" hotkey="c" onPress={compact} />
          <Button key="refresh" label="Refresh" hotkey="r" onPress={reload} />
        </Box>
        {d.note !== '' && <Text color="magenta">{d.note}</Text>}
      </Box>
    )
  })
}
