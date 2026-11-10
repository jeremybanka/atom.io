---
"@atom.io/spa": patch
"@atom.io/spa-devtools": patch
"atom.io": patch
---

Add onCommit for tracked measurements and other work that needs the updated DOM or scene. Callbacks run after refs and renderer writes within the same flush, clean up with their owner, and can schedule another round of updates before paint.
