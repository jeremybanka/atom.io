# React Realtime Text Editor

Mosaic is a React + atom.io multiplayer Markdown editor with simulated
identities. It demonstrates the scalable long-form text path: bounded Domain
members, viewport-first residency, logical presence, selective history,
incremental parsing, and virtualized source and preview rendering.

## Run It

Run `npm run dev`, then open the displayed Vite URL in two tabs and choose a
different identity in each tab. The browser connects to `window.location.origin`.
Vite proxies `/socket.io` and `/health` to the collaboration service in both
development and preview, so the deployment contract does not require browser
CORS exceptions.

## What It Shows

- one logical Markdown document indexed by bounded-fanout ordinary Domain atom
  families;
- viewport hydration before full materialization, with released ranges evicted;
- local input drafts that remain responsive while offline or while an
  authoritative gesture settles;
- run-relative selection, viewport, and collaborator presence across physical
  leaf splits and merges;
- a Lexical plain-text editing surface that renders named remote carets and
  translucent selections without delegating convergence or history to a second
  collaboration model;
- actor-selective undo and redo whose text compensation and index maintenance
  settle in one Domain revision;
- cancelable incremental Markdown parsing that yields outside the input turn and
  stops propagating when cached parser state reaches a stable boundary;
- source and preview virtualization with no architecture switch at the 5.6 MB or
  deterministic 50 MB corpus sizes; and
- one explicitly authorized reset/import transaction rather than an effect run
  by every joining browser.

Run `npm test` for the multi-client contention, offline/reconnect, history,
presence, import, parser, and virtualization scenarios. Run `npm run lint` to
enforce ESLint, type-aware Oxlint, React hook call-order correctness, TypeScript,
and the Lasertag render-story/CSS relationship with zero warnings. Run
`npm run fmt:check` in CI and `npm run fmt` to apply the pinned dprint
configuration locally. The scheduled repository command
`pnpm test:large-document` verifies the pinned corpus and exercises the same
logical editing, history, residency, and viewport/parser contracts over Mosaic
Text v3's content-addressed storage roots. It runs sequentially with one
authoritative document graph at a time across the canonical 5.6 MB document,
the deterministic 50 MB repetition, huge-paragraph and fenced-block shapes, and
the Unicode adversarial corpus.

## Start Reading

- `src/document-domain.ts` names the application's durable source and index
  members plus its ephemeral collaborator shape. Core supplies the text and
  index models, schemas, and history policy.
- `node/service.ts` chooses persistence, authorization, presence lifetime, and
  the app-specific Socket.IO commands. The core text document coordinator owns
  atomic source/index proposals, range reads, and history compensation, while
  the core residency binder owns its wire protocol.
- `src/collaboration-client.ts` supplies browser identity, viewport policy, and
  application commands. Core owns residency transport, reconnect
  synchronization, accepted-revision settlement, presence renewal, and
  selective history sequencing.
- `atom.io/realtime-client` owns the Store-backed range controller, preserving
  the last complete projection while replacement residency is acquired.
- `atom.io/realtime-react` owns optimistic draft settlement and maps local and
  remote selections across complete, revision-tagged projection cuts.
- `atom.io/realtime-react-lexical` owns projection replacement, native input
  boundaries, DOM selection restoration, collaborator geometry, and its
  internal stylesheet. The local `src/LexicalMarkdownEditor.tsx` imports that
  supported stylesheet and supplies only template theme and layout variables.
- `src/incremental-markdown.ts` contains the renderer-neutral, cancelable parser.
- `src/workspace-state.ts` expresses status, presence, viewport, parser output,
  diagnostics, and derived peers as Atom state. `src/MarkdownWorkspace.tsx`
  reads those tokens and owns only application presentation and interaction.
- `INNOVATIONS.md` records the new core seam and the deliberate production
  boundaries.

The template uses in-memory persistence and simulated authorization for a
zero-setup demo. A production service still needs a linearizable storage
adapter, document ACLs, rate limits, metrics, and a durable offline-retention
policy. The corpus gate deliberately uses the same public checkpoint adapter
contract as production, including restart, proposal expiry, retention fences,
and garbage collection; wall-clock and RSS readings are diagnostics rather than
portable release thresholds.
