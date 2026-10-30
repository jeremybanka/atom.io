---
"@atom.io/spa": patch
"atom.io": patch
---

Add useLoadable accessors for readable tokens and families, including initial loading, explicit fallbacks, last-observed values during refresh, and declared errors. Document async rendering, add consumer and runtime coverage, and include an async serving recipe. Use ordinary level-9 gzip for the full-client 3,300-byte budget and remove Zopfli compression machinery.
