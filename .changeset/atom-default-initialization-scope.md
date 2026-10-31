---
"atom.io": patch
---

Allow integrations to evaluate atom defaults in their owning store's synchronous initialization scope through Store.runDefault. Apply the scope to ordinary defaults and lazy family defaults, and preserve it through transaction resets. This lets module-scoped atom definitions consume request or browser resumption data without redefining the state graph for each island. Unconfigured stores retain their existing behavior.
