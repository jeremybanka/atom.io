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

## Bounded history

A timeline can declare `retention` with a non-negative safe-integer
`maxUndoSteps` and the `drop-oldest` overflow strategy. The limit counts logical
undo checkpoints rather than internal events. A selector write, transaction,
nested transaction, or multi-atom transaction is therefore retained or evicted as
one complete step.

<Exhibit src="core/timeline/retain-bounded-history.ts" />

When a new change is recorded after an undo, the redo branch is removed first and
the capacity is then applied to the resulting undo branch. Every subscriber update
reports the final cursor and length after both operations.

`clearTimeline` empties the history and leaves its retention policy active. Undo,
redo, `undoTransaction`, and `redoTransaction` can only move checkpoints that are
still retained. Transaction controls remain best-effort across timelines: a
timeline where that transaction was evicted is simply not a participant.

Disposal removes an ordinary timeline and its policy; declaring it again determines
the new policy. A timeline-family policy belongs to the family, so every member
enforces the limit independently and a member recreated after disposal receives the
same policy. Silo-bound timelines and timeline families use the same options and
behavior.

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
