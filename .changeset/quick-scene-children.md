---
"@atom.io/spa": patch
---

Skip parent scene synchronization for unchanged child lists, including sceneComponent wrappers, and combine child creation notifications during reconciliation. Konva and Three skip unchanged native child arrays and use set membership for removals; Konva restacks ordinary containers with one renumbering while preserving native Stage layer ordering.
