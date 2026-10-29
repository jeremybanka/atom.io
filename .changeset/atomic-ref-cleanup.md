---
"@atom.io/react": minor
---

**Breaking:** `useAtomicRef` now publishes `null` to its previous atom when the component unmounts or its target state or store changes. Consumers must handle detachment rather than rely on a retained DOM node; atom effects can use this transition to release attached resources. Host changes are published after commit, while unchanged hosts are not republished. Cleanup skips members that have already been disposed. The hook does not automatically dispose atoms.
