---
"@atom.io/spa": patch
"atom.io": patch
---

Recover from hydration mismatches by repairing affected DOM nodes and removing unexpected leftovers during the same hydration pass. Log one human-readable warning per root in development and production, including the affected host, expected/found nodes, and potential loss of focus or unsaved input in replaced nodes. Keep component setup, mount hooks, subscriptions, island lifetimes, and neighboring roots running. Honor explicit client ID prefixes during recovery and raise the audited client gzip budget to 4,300 bytes to include recovery and production diagnostics.
