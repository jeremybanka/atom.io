---
"@atom.io/eslint-plugin": patch
"atom.io": patch
---

Add the opt-in `atom.io/ban-use-effect` rule to reject React `useEffect` imports and references while allowing `useLayoutEffect`. Diagnostics link to the “against useEffect” web guide and its local copy in `node_modules/atom.io/docs/agent/packages/against-use-effect.md`.
