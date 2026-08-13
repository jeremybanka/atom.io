---
"atom.io": patch
---

Add a deterministic in-memory realtime transport, a shared Socket.IO adapter
contract, composable network fault policies, replayable delivery schedules, and
a virtual test clock. Realtime subscription coalescing now accepts the shared
clock seam that future lease, expiry, and retry policies can also use.
