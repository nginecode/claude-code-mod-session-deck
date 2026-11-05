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
  note: '',
}

// Змініть тег, коли змінюється форма Deck: він відхиляє збережене старою версією.
const deck = atom({ plugin: 'session-deck', key: 'deck' } as const, EMPTY, {
  shape: 'deck-1',
})

const tone = (p: number) => (p >= 85 ? 'red' : p >= 60 ? 'yellow' : 'green')

const bar = (p: number, width: number) => {
  const n = Math.round((Math.min(100, Math.max(0, p)) / 100) * width)
  return '█'.repeat(n) + '░'.repeat(width - n)
}

const secs = (ms: number) =>
  ms < 60_000
    ? `${(ms / 1000).toFixed(1)}с`
    : `${Math.floor(ms / 60_000)}хв ${Math.floor((ms % 60_000) / 1000)}с`

const kilo = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n))

const windowName = (kind: string) =>
  kind === 'five_hour' ? '5 год' : kind === 'seven_day' ? '7 діб' : kind

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

async function refresh($: Api) {
  const [usage, model, cwd, turns] = await Promise.all([
    $.session.usage(),
    $.session.model(),
    $.session.cwd(),
    $.session.turns(),
  ])
  await update($, deck, d => ({
    ...d,
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
    // Таймер лише просить перемалювати панель: лічильник тривалості ходу
    // обчислюється при малюванні.
    $.clock.every(1000, () => $.ui.invalidate('ui.render'))
    await refresh($)
    void $.ui.open({ id: PANE, title: 'Сесія' })
    await $.command.register({
      name: 'session-deck',
      description: 'Відкрити панель сесії з кнопками керування',
    })

    return next(e)
  })

  on('command.run', { command: 'session-deck' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Сесія', focus: true })

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
    // Збій панелі не повинен блокувати виклик інструмента.
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
      if (!cur.turnId) return note('Немає ходу, який можна зупинити')
      try {
        await $.turn.abort({ turnId: cur.turnId })
        await note('Хід зупинено')
      } catch (err) {
        await note('Не вдалося зупинити: ' + message(err))
      }
    }

    const compact = async () => {
      const cur = await read($, deck)
      if (cur.turnId) return note('Спершу зупиніть поточний хід')
      try {
        await $.session.compact()
        await refresh($)
        await note('Контекст стиснуто')
      } catch (err) {
        await note('Не вдалося стиснути: ' + message(err))
      }
    }

    const reload = async () => {
      try {
        await refresh($)
        await note('Оновлено')
      } catch (err) {
        await note('Не вдалося оновити: ' + message(err))
      }
    }

    return (
      <Box flexDirection="column" rowGap={1}>
        <Box flexDirection="row" columnGap={2}>
          <Text bold color="magenta">
            ◆ СЕСІЯ
          </Text>
          {working ? (
            <Text inverse bold color="yellow">
              {' '}
              ПРАЦЮЄ {secs(Math.max(0, now - d.startedAt))}{' '}
            </Text>
          ) : (
            <Text inverse bold color="green">
              {' '}
              ПРОСТОЮЄ{' '}
            </Text>
          )}
        </Box>

        <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
          <Box flexDirection="row" columnGap={2}>
            <Text bold color="cyan">
              {d.model || '—'}
            </Text>
            <Text color="blue">ходів: {d.turns}</Text>
            {d.costUsd !== null && <Text color="yellow">${d.costUsd.toFixed(2)}</Text>}
          </Box>
          <Text dimColor wrap="truncate-end">
            {d.cwd || '—'}
          </Text>
        </Box>

        <Box flexDirection="column" borderStyle="round" borderColor={tone(ctx)} paddingX={1}>
          <Box flexDirection="row" columnGap={1}>
            <Text bold>контекст</Text>
            <Text color={tone(ctx)}>{bar(ctx, width)}</Text>
            <Text bold color={tone(ctx)}>
              {d.percent === null ? '—' : d.percent + '%'}
            </Text>
          </Box>
          {d.tokens !== null && d.window > 0 && (
            <Text dimColor>
              {kilo(d.tokens)} / {kilo(d.window)} токенів
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
            <Text dimColor>інструменти не виконуються</Text>
          )}
          {d.last && (
            <Text dimColor>
              останній хід: {secs(d.last.ms)}, {d.last.reason}
            </Text>
          )}
        </Box>

        <Box flexDirection="row" columnGap={2}>
          <Button key="stop" label="Стоп" hotkey="s" onPress={stop} />
          <Button key="compact" label="Стиснути" hotkey="c" onPress={compact} />
          <Button key="refresh" label="Оновити" hotkey="r" onPress={reload} />
        </Box>
        {d.note !== '' && <Text color="magenta">{d.note}</Text>}
      </Box>
    )
  })
}
