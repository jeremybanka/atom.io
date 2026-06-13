---
"atom.io": patch
---

Expand `atom.io/testing` with public helpers for stable public-contract tests: `stateExists`, `stateExistsInStore`, `storeHasStateValues`, `hasImplicitStoreBeenCreated`, `setTestLogLevel`, and `takeSnapshot`. `takeSnapshot().restore()` now restores the implicit store in place so React and Solid contexts keep a stable store reference.
