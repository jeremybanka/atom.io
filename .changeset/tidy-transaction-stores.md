---
"atom.io": patch
---

Replace generic object assignment in transaction construction, mutable-state tracking, store clearing, and snapshot restoration with explicit construction and field assignment to improve performance while preserving store identity.
