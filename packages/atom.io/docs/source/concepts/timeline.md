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

For mutable atoms, timelines record both inner transceiver signals and whole-
reference replacements. Each change produces one undoable history entry.

Use timelines for editors, design tools, form flows, and other interfaces where
users expect undo and redo.

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
