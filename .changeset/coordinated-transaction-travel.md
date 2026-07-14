---
"atom.io": patch
---

Add best-effort `undoTransaction` and `redoTransaction`. Each operation moves the
transaction on every timeline where it is at the relevant history head while
leaving diverged timelines unchanged. Silo methods and situational React and Solid
`useTL` controls provide the same behavior. Transactions that span independent
timelines can lose atomicity over time as those histories move apart; keep related
state in one timeline when its history must remain inseparable.
