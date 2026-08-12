---
"atom.io": patch
---

Replace realtime push mutexes with renewable, expiring, generation-fenced
leases. Push publications now carry lease identity and sequence metadata,
validated publications commit in receive order, and stale owners cannot write
after handoff. Detailed lease status is available through `usePushStatus`.
