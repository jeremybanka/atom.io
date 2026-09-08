---
"atom.io": patch
---

Share the implicit store and React, Solid, and realtime React contexts across duplicate compatible atom.io installs using a realm-global, ABI-versioned runtime registry. Providers and hooks from separate package copies now use the same explicit store while nested providers and separate roots retain independent values. Incompatible runtime ABIs and legacy unversioned runtimes remain isolated.
