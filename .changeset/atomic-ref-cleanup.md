---
"@atom.io/react": minor
---

**Breaking:** `useAtomicRef` now publishes `null` to its previous atom when the component unmounts or its target state or store changes. Consumers must handle detachment rather than rely on a retained DOM node; atom effects can use this transition to release attached resources. Rerenders targeting the same state no longer republish the ref. The atom remains available and is not automatically disposed.
