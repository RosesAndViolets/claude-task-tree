import { expect, mock, test } from 'claude-code/testing'

const JOBS = {
  jobs: [{
    id: 'j', title: 'Job',
    children: [
      { id: 'p1', title: 'Piece one', children: [
        { id: 'p1a', title: 'built', state: 'done', durationMs: 60000, tokens: 1000 },
      ] },
      { id: 'p2', title: 'Piece two', children: [
        { id: 'p2a', title: 'building', state: 'running', startedAt: '2026-11-08T00:00:00Z' },
        { id: 'p2b', title: 'review', state: 'todo' },
      ] },
    ],
  }],
}

const PANE = {
  plugin: 'task-tree', component: 'Pane', requestId: 'task-tree',
  props: { title: 'Task tree', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

test('a finished piece starts folded, a press unfolds it, and back', async ($, on) => {
  on('fs.read', () => ({ value: JSON.stringify(JOBS) }))
  mock.store(on)
  mock.clock(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    // Done piece folded: its leaf is hidden; the running piece is open.
    expect(await ui.find({ type: 'Text', text: /built/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /building/ })).toBeDefined()
    // Tree lines, no row numbers.
    expect(await ui.find({ type: 'Text', text: /└─/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\s*\d+ / })).toBeUndefined()
    await ui.press({ key: 'fold-p1' })
    expect(await ui.find({ type: 'Text', text: /built/ })).toBeDefined()
    await ui.press({ key: 'fold-p1' })
    expect(await ui.find({ type: 'Text', text: /built/ })).toBeUndefined()
    await ui.unmount()
  }
})
