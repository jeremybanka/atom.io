---
"atom.io": minor
---

Add atom-style effects for timelines and timeline families. Effects can observe
complete logical records, safely cull undo steps before settlement or at arbitrary
times, reserve alternate-history collection for future branching support, and
clean up on disposal in implicit-store and Silo APIs. Arbitrary culls publish a
structured event with their before-and-after logical undo-step counts.

Export `DeepReadonly` from `atom.io/foundations/type-utils` and use it to expose
timeline record events as deeply readonly data.
