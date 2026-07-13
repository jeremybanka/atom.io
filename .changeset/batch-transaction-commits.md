---
"atom.io": minor
---

Add strict and preferred batched transaction commit strategies that install final atom values and epochs before notifying subscribers. Batched commits now isolate observer failures, finalize timeline and outcome publication, drain reentrant work in order, and report collected failures only after the commit is complete.
