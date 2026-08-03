---
slug: timeline
title: Timeline
summary: A history tracker for undoing and redoing state changes.
packages:
  - atom.io
  - atom.io/react
related:
  - transaction
  - mutable-atom
  - transceiver
---

A timeline records changes to a group of reactive values so they can be undone
and redone.

Timelines pair naturally with transactions. A transaction can describe a
meaningful operation, while a timeline records the resulting changes as history.
When one transaction is recorded by several timelines, `undoTransaction` and
`redoTransaction` move it wherever it is currently at a timeline head. A timeline
that has moved elsewhere is left alone. Ordinary `undo` and `redo` remain local to
one timeline.

The transaction applies atomically when it runs, but recording its effects in
multiple timelines means those effects can later move independently. In other
words, crossing timeline boundaries can break the transaction's atomicity over
time. If the effects must always remain inseparable, do not update atoms from
multiple timelines in one transaction; keep that state in one timeline instead.

For mutable atoms, timelines record both inner transceiver signals and whole-
reference replacements. Each change produces one undoable history entry.

Use timelines for editors, design tools, form flows, and other interfaces where
users expect undo and redo.

## Timeline effects

A timeline can declare `effects` that observe and safely collect its history.
`onRecord` runs once for each complete logical update before that update settles.
The record passed to each callback is deeply readonly, so an effect can inspect
history without accidentally changing the timeline's stored event.
Calling `cullUndoSteps` there retains at most the requested number of undo steps.
The limit counts logical checkpoints rather than internal events, so a selector
write, transaction, nested transaction, or multi-atom transaction is retained or
collected as one complete step.

<Exhibit src="core/timeline/retain-bounded-history.ts" />

Without an effect, undo history is unlimited. Effects may also call
`cullUndoSteps` at arbitrary times, subscribe to application-owned clocks or policy
signals, and return cleanup for timeline disposal. Increasing a later limit does
not restore history that has already been collected. An arbitrary cull that
removes history publishes a `timeline_cull` event whose `from` and `to` fields
count logical undo steps. Culling during `onRecord` remains part of that record's
single atomic timeline update.

Timeline-family `effects` is a factory keyed like atom-family effects, so every
member owns independent effect state and cleanup. Silo-bound timelines and
timeline families use the same effect APIs.

Recording after an undo removes the redo branch before effects settle the new
update. Subscribers observe only the final cursor and length. `clearTimeline`
empties history but leaves effects active, while disposal runs effect cleanup.
`undoTransaction` and `redoTransaction` can move only transaction checkpoints that
remain available.

## Keyed timeline families

A timeline family partitions one or more atom families into independent histories.
Each scoped atom family supplies a routing extractor: it maps the member's canonical
key to its owning timeline key, or returns `undefined` to exclude that member.

Timeline-family members are lazy. Looking up or operating on a key creates its
timeline and attaches the matching atoms that are currently live. Disposing a member
releases its subscriptions and permanently clears its history; looking up the same
key later creates a fresh timeline.

An atom family can belong to only one ordinary timeline or timeline family. This
keeps ownership deterministic even when some members are filtered out.
