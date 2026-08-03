---
"atom.io": minor
---

Add declarative, transaction-safe bounded retention for timelines and timeline
families. `maxUndoSteps` limits complete undo checkpoints, drops the oldest groups
on overflow, and is supported by implicit-store and Silo APIs.
