---
"atom.io": patch
---

Keep timeline history scoped to the atoms each timeline owns. Selector writes no
longer leak unrelated updates into sibling histories, transactions retain atom
creation and disposal events, and mutable family members reattach correctly after
disposal.
