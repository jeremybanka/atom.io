---
"@atom.io/realtime": minor
---

Release realtime collaboration as `@atom.io/realtime` 0.1.0, with shared protocol and models at the package root and `/client`, `/server`, `/react`, `/react/lexical`, `/testing/headless`, and `/testing/react` entry points. Replace the old `atom.io/realtime*` imports with the corresponding entries. Require `atom.io` ^0.54.0 and declare optional peers for renderer, transport, and test integrations, including `@atom.io/react` ~0.1.0. React APIs expose the shared socket contract instead of Socket.IO-specific types; retain a concrete socket separately when using transport-specific facilities. The server entry point targets Node; Cloudflare support remains follow-up work.

Add Mosaic Domains for atomic replication of heterogeneous transactions, bounded partial residency, renewable presence, incremental checkpoint recovery, and actor-scoped undo and redo. Provide authenticated client and server adapters, atomic text/index document services, and reusable deterministic multi-client conformance testing.

Replace the previous node-based Mosaic Text model with compact logical runs, stable run-relative positions, bounded indexing, viewport projections, and incremental storage roots for large documents. This changes the public node, operation, selection, and history shapes: positions use `runId` and `offset`, and the run-text model and its snapshots use version 2. Existing node-based snapshots are not accepted by the new snapshot loader. Migrate or reimport stored documents and coordinate client/server protocol upgrades; changing package imports alone does not migrate persisted data.

Add optimistic text editing, revision-aware projections, session and residency coordination, a Store-owned text range controller, and a headless Lexical adapter. Consumers can compose editing status, collaborator geometry, and viewport residency without standard React state or effect hooks, and supply styling through a root class and typed part classes.

Return stable per-submission receipts from Mosaic Domain batch clients, with transaction-to-batch correlation and React status hooks. Distinguish authoritative acceptance or rejection from offline and interrupted outcomes. Callers may await and discard `submit` results; explicit `Promise<void>` wrappers must discard the receipt or adopt the new return type. Preserve detailed server-validation and client-protocol errors in logs while exposing safe public reasons.

Ship guides and typechecked exhibits for rigid synchronization, Atomic Mosaic, Mosaic Domains, text editors, storage, recovery, presence, history, and conformance testing. Document import and protocol migration, queued optimism, rejection retry, and receipt ownership. Generate the package README from MDX with shared branding, source-backed documentation, and a generated-file notice.
