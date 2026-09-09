---
"atom.io": patch
---

Share React, Solid, and realtime React contexts across duplicate atom.io installs so providers and hooks from separate package copies use the same explicit store. Nested providers and separate roots retain independent values, and the existing implicit-store behavior is preserved.
