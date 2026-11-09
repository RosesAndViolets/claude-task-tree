import type { EngineInterface, Register, RenderChildren } from 'claude-code'

// The orchestrator keeps this file current; the pane only reads it.
const REL = '.claude/plans/tasks.json'
// Under the home folder, so the mod works on any computer.
const fileOf = async ($: EngineInterface) => {
  try {
    return `${(await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '~'}/${REL}`
  } catch {
    return `~/${REL}`
  }
}
const PANE = 'task-tree'

type State = 'done' | 'running' | 'todo'
type Task = {
  id: string
  title: string
  state?: State
  agent?: string
  commit?: string
  startedAt?: string
  durationMs?: number
  tokens?: number
  weekPct?: number
  children?: Task[]
}
type Folds = Record<string, boolean>

const ICON: Record<State, string> = { done: '✓', running: '▶', todo: '○' }
const COLOR: Record<State, string | undefined> = { done: 'green', running: 'yellow', todo: undefined }

const fmtMs = (ms: number) => {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}
const fmtTok = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`)

// A parent takes its state from its children; a leaf says its own.
const stateOf = (t: Task): State => {
  const kids = t.children ?? []
  if (!kids.length) return t.state ?? 'todo'
  const s = kids.map(stateOf)
  if (s.every(x => x === 'done')) return 'done'
  if (s.some(x => x !== 'todo')) return 'running'
  return 'todo'
}
const leaves = (t: Task): Task[] => (t.children?.length ? t.children.flatMap(leaves) : [t])

// Every node below the job with children folds; a finished one starts folded.
const foldable = (t: Task, depth: number) => depth > 0 && !!t.children?.length
const isFolded = (t: Task, folds: Folds) => folds[t.id] ?? stateOf(t) === 'done'

// Every foldable node with its depth, for `/task-tree <words>`.
const foldables = (jobs: Task[]): Task[] => {
  const out: Task[] = []
  const walk = (t: Task, depth: number) => {
    if (foldable(t, depth)) out.push(t)
    for (const c of t.children ?? []) walk(c, depth + 1)
  }
  for (const j of jobs) walk(j, 0)
  return out
}

async function weekNow($: EngineInterface): Promise<{ pct?: number; resetsAt?: string }> {
  try {
    const w = (await $.session.usage()).rateLimits.find(r => r.kind === 'seven_day')
    return w ? { pct: w.percentUsed, resetsAt: w.resetsAt } : {}
  } catch {
    return {}
  }
}

async function readJobs($: EngineInterface): Promise<Task[] | string> {
  const file = await fileOf($)
  try {
    return JSON.parse(await $.fs.read(file)).jobs ?? []
  } catch (e) {
    return `Can't read ${file}: ${String(e)}. Nothing shows until a job list is kept there.`
  }
}

async function getFolds($: EngineInterface): Promise<Folds> {
  return ((await $.store.get('folds')) ?? {}) as Folds
}

async function toggleFold($: EngineInterface, id: string) {
  const jobs = await readJobs($)
  if (typeof jobs === 'string') return
  const folds = await getFolds($)
  const t = jobs.flatMap(function all(x: Task): Task[] { return [x, ...(x.children ?? []).flatMap(all)] }).find(x => x.id === id)
  if (t) await $.store.set('folds', { ...folds, [id]: !isFolded(t, folds) })
  $.ui.invalidate('ui.render') // draw now, not at the next 10 s tick
}

function open($: EngineInterface) {
  return $.ui.open({ id: PANE, title: 'Task tree' })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'task-tree',
      description: 'Show the job tree pane; `/task-tree 조각 3` folds or unfolds that piece, `all`/`none` folds every piece or none',
    })
    void open($)
    // Every 10 s: snapshot the weekly % when a leaf starts or finishes, and
    // bump a tick so the pane redraws with fresh file contents and elapsed time.
    $.clock.every(10_000, async () => {
      const jobs = await readJobs($)
      if (typeof jobs !== 'string') {
        const { pct } = await weekNow($)
        if (pct !== undefined) {
          for (const t of jobs.flatMap(leaves)) {
            const s = stateOf(t)
            if (s === 'running' && (await $.store.get(`wk:${t.id}:start`)) === undefined)
              await $.store.set(`wk:${t.id}:start`, pct)
            if (s === 'done' && (await $.store.get(`wk:${t.id}:start`)) !== undefined && (await $.store.get(`wk:${t.id}:end`)) === undefined)
              await $.store.set(`wk:${t.id}:end`, pct)
          }
        }
      }
      await $.store.set('tick', await $.clock.now())
    })
    return next(e)
  })

  on('command.run', { command: 'task-tree' }, async ($, e) => {
    await open($)
    const arg = (e.args ?? '').trim()
    if (!arg) return { text: 'Task tree pane opened.' }
    const jobs = await readJobs($)
    if (typeof jobs === 'string') return { text: jobs }
    if (arg === 'all' || arg === 'none') {
      const folds: Folds = {}
      const walk = (t: Task, depth: number) => {
        if (foldable(t, depth)) folds[t.id] = arg === 'all'
        for (const c of t.children ?? []) walk(c, depth + 1)
      }
      for (const j of jobs) walk(j, 0)
      await $.store.set('folds', folds)
      $.ui.invalidate('ui.render')
      return { text: arg === 'all' ? 'Folded every piece.' : 'Unfolded every piece.' }
    }
    const t = foldables(jobs).find(x => x.title.toLowerCase().includes(arg.toLowerCase()))
    if (!t) return { text: `No piece titled like "${arg}". Try e.g. /task-tree 조각 3, or all/none.` }
    await toggleFold($, t.id)
    return { text: `Toggled: ${t.title}` }
  })

  // A press is answered here, on a dispatch of its own: a closure kept from the
  // drawing ran with the drawing's `$`, which may not write, so nothing folded.
  on('ui.press', { plugin: 'task-tree' }, async ($, e, next) => {
    if (!e.element.startsWith('fold-')) return next(e)
    await toggleFold($, e.element.slice('fold-'.length))
    return { element: e.element }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const now = Number((await $.store.get('tick')) ?? (await $.clock.now())) // subscribes to the tick
    const jobs = await readJobs($)
    if (typeof jobs === 'string') return <Text color="red">{jobs}</Text>
    const week = await weekNow($)
    const folds = await getFolds($)

    // ponytail: weekly % per task is (week % at finish) − (week % at start), so it
    // counts every session's use in that window, and only for tasks that ran
    // while this pane was loaded. Earlier tasks show tokens and time only.
    const wkDelta = async (t: Task) => {
      if (t.weekPct !== undefined) return t.weekPct
      const a = (await $.store.get(`wk:${t.id}:start`)) as number | undefined
      if (a === undefined) return undefined
      const b = ((await $.store.get(`wk:${t.id}:end`)) as number | undefined) ?? week.pct
      return b === undefined ? undefined : Math.max(0, Math.round((b - a) * 10) / 10)
    }

    // One right-hand column, every field padded to a fixed width: a terminal is
    // monospaced, so time, tokens and commit line up under each other.
    // `guide` is the tree drawing before the title, like `tree`: ├─ └─ │.
    type Row = { t: Task; depth: number; guide: string; s: State; ms?: number; tok?: number; wk?: number }
    const list: Row[] = []
    const walk = async (t: Task, depth: number, lead = '', last = true) => {
      const guide = depth === 0 ? '' : lead + (last ? '└─ ' : '├─ ')
      const childLead = depth === 0 ? '' : lead + (last ? '   ' : '│  ')
      const s = stateOf(t)
      const ls = leaves(t)
      const parent = !!t.children?.length
      const ms = parent
        ? ls.reduce((n, l) => n + (l.durationMs ?? 0), 0) || undefined
        : t.durationMs ?? (s === 'running' && t.startedAt && now > Date.parse(t.startedAt) ? now - Date.parse(t.startedAt) : undefined)
      const tok = parent ? ls.reduce((n, l) => n + (l.tokens ?? 0), 0) || undefined : t.tokens
      list.push({ t, depth, guide, s, ms, tok, wk: parent ? undefined : await wkDelta(t) })
      const kids = t.children ?? []
      if (!(foldable(t, depth) && isFolded(t, folds)))
        for (const [i, c] of kids.entries()) await walk(c, depth + 1, childLead, i === kids.length - 1)
    }
    for (const j of jobs) await walk(j, 0)
    const hasWk = list.some(r => r.wk !== undefined)

    const rows: RenderChildren[] = list.map(({ t, depth, guide, s, ms, tok, wk }) => {
      const kids = t.children ?? []
      const counts = kids.length ? `  ${leaves(t).filter(l => stateOf(l) === 'done').length}/${leaves(t).length}` : ''
      const time = ms ? (s === 'running' && !kids.length ? `${fmtMs(ms)}…` : fmtMs(ms)) : ''
      const meta =
        time.padStart(8) +
        (tok ? `🪙 ${fmtTok(tok)}` : '').padStart(9) + // 🪙 is two columns wide and two code units: padStart stays right

        (hasWk ? (wk !== undefined ? `+${wk}%` : '').padStart(7) : '') +
        (t.commit ?? '').padStart(9)
      const canFold = foldable(t, depth)
      const title = (
        <Text color={COLOR[s]} dimColor={s === 'todo'} bold={depth === 0 || s === 'running'}>
          {canFold ? `${isFolded(t, folds) ? '▸' : '▾'} ` : ''}
          {ICON[s]} {t.title}
          {counts}
        </Text>
      )
      return (
        <Box key={t.id} flexDirection="row" width="100%">
          <Box flexGrow={1} flexShrink={1} flexDirection="row">
            {guide ? <Text dimColor>{guide}</Text> : null}
            {canFold ? (
              <Button key={`fold-${t.id}`} plain onPress={() => {}}>
                {title}
              </Button>
            ) : (
              title
            )}
          </Box>
          <Box flexShrink={0}>
            <Text dimColor={s !== 'running'} color={s === 'running' ? 'yellow' : undefined}>{meta}</Text>
          </Box>
        </Box>
      )
    })

    const all = jobs.flatMap(leaves)
    const c = (s: State) => all.filter(l => stateOf(l) === s).length
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color="green">✓ {c('done')} done</Text>
          <Text>{'   '}</Text>
          <Text color="yellow">▶ {c('running')} running</Text>
          <Text>{'   '}</Text>
          <Text dimColor>○ {c('todo')} left</Text>
          {week.pct !== undefined ? <Text dimColor>{`   week used ${week.pct}%`}</Text> : null}
        </Box>
        <Text> </Text>
        {rows}
        <Text> </Text>
        <Text dimColor>{'Click ▸/▾ to fold · or /task-tree 조각 3 (all, none)'}</Text>
        <Text dimColor>🪙 tokens = the subagent's own; my own work isn't counted</Text>
      </Box>
    )
  })
}
