---
"@atom.io/react": patch
"atom.io": patch
---

Scope React `useLoadable` retention to the selected state in its store. Switching family keys or tokens uses that member's previous settled value during refresh, or the current fallback or `"LOADING"` if it has none. Preserve same-member refresh and caught-error retry behavior, support `null` fallbacks, and document retention and error handling, including the fixed-member accessor behavior in Solid and SPA.
