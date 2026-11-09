# task-tree

A Claude Code mod: a side pane that shows a job tree (done / running / left, with time and tokens).

Install:

    /plugin install task-tree --marketplace RosesAndViolets/claude-task-tree

It reads `~/.claude/plans/tasks.json`. Nothing shows until that file exists:

    { "jobs": [ { "id": "j1", "title": "My job", "children": [
        { "id": "j1a", "title": "step one", "state": "done", "durationMs": 60000, "tokens": 1200, "commit": "abc123" },
        { "id": "j1b", "title": "step two", "state": "running", "startedAt": "2026-11-09T01:00:00Z" } ] } ] }

`state` is `done`, `running` or `todo`. Parents take their state from their children.
Open the pane with `/task-tree`. `/task-tree <words>` folds a piece; `all` / `none` folds every piece or none.
