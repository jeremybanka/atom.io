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
one-batch Domain composition, bounded index routing, and viewport/parser path at
the beginning, middle, and end of both canonical sizes.

## Start Reading

- `src/document-domain.ts` declares the ordinary durable source, index root,
  index family, local selection, and ephemeral collaborator members.
- `node/service.ts` is the authoritative composition seam. It serializes a text
  gesture with MOS-15 index maintenance and delegates history retention and
  compensation to MOS-16.
- `src/collaboration-client.ts` combines MOS-12 residency, MOS-17 range
  projections, presence, current-location transport, and reconnecting command
  delivery.
- `src/incremental-markdown.ts` contains the renderer-neutral, cancelable parser.
- `src/MarkdownWorkspace.tsx` owns only React viewport, local input, and DOM
  lifecycle state.
- `INNOVATIONS.md` records the new core seam and the deliberate production
  boundaries.

The template uses in-memory persistence and simulated authorization for a
zero-setup demo. A production service still needs a linearizable storage
adapter, document ACLs, rate limits, metrics, and a durable offline-retention
policy.
