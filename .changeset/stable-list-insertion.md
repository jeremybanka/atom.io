---
"@atom.io/spa": patch
"@atom.io/spa-devtools": patch
---

Insert new DOM child records at their intended position so keyed list insertions and conditional sibling type changes leave existing rows attached, preserving scroll, focus, animations, and embedded content. Track prior record positions directly to avoid quadratic index lookup when retiring rows.
