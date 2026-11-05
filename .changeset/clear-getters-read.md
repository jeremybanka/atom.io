---
"@atom.io/spa": patch
---

Rename `useValue` to `useGetter`. `useTimeline` now returns a stable `TimelineControls` object instead of an accessor returning `TimelineValue`: read metadata with `history.getCursor()` and `history.getLength()`, call `history.undo()`, `history.redo()`, and `history.clear()` directly, and retrieve captured transaction-group actions through `history.getTransaction().undo?.()` and `history.getTransaction().redo?.()`. These breaking API changes ship as a patch under the 0.0.x release policy.
