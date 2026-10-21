---
"atom.io": minor
"@atom.io/realtime": patch
"@atom.io/template-preact-realtime-vector-editor": patch
"@atom.io/template-preact-svg-editor": patch
"@atom.io/template-react-realtime-text-editor": patch
---

Extract realtime into `@atom.io/realtime`, with shared protocol and models at the package root and client, server, React, Lexical, and testing subpaths. Replace imports from `atom.io/realtime*` with the corresponding new package entries. The new package requires `atom.io` ^0.54.0 and declares optional peers for renderer, transport, and test-environment integrations. React now exposes the shared socket contract instead of Socket.IO-specific types. The core SDK remains dependency-free and no longer exports realtime. Existing realtime behavior and package-owned tests move with the implementation; Cloudflare transport support remains follow-up work.
