---
"@atom.io/spa": patch
"@atom.io/spa-devtools": patch
"atom.io": patch
---

Add the SPA Root boundary for subtree store, ID prefix, capability, and error handler overrides. DOM and scene children share the enclosing root's scheduler and borrow the selected store. Server rendering and hydration use the same scope rules.
