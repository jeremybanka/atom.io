# React Realtime Markdown

Mosaic is a React + atom.io multiplayer Markdown editor with a small Node and
Socket.IO collaboration server. It ships simulated identities so the complete
shared-editing experience can be explored locally without provisioning auth.

## Run It

Run `npm run dev`, then open the displayed Vite URL. Open a second tab and use
the avatar menu to switch identities. The Vite app runs on port 5173 and the
collaboration service runs on port 3000. The browser always connects to its
current origin; Vite proxies `/socket.io` and `/health` to the collaboration
service in both development and preview modes.

## What It Shows

- optimistic shared text that converges after simultaneous and offline edits;
- live identity, connection, caret, and line-level presence;
- selection anchors that survive edits around them;
- per-identity undo and redo that preserve other authors' work;
- durable-stream snapshots, idempotent operation replay, and server validation;
- a safe, dependency-free Markdown preview rendered as React nodes; and
- structural component styling checked by Lasertag.

Run `npm test` for the multi-client collaboration scenarios. Run `npm run lint`
to check TypeScript, ESLint, and the Lasertag render-story/CSS relationship.

## Start Reading

- `src/collaboration/mosaic.ts` is the browser collaboration contract: one
  resource, a text model, selective history, and model-relative presence.
- `node/mosaic-resource.ts` adds the server's runtime schemas, history policy,
  presence validation, and checkpoint cadence without entering the browser
  bundle.
- atom.io's Mosaic client owns optimistic edits, reconnect rebasing, causal
  retries, and structured recovery.
- atom.io's Mosaic server authenticates authorship, durably orders revisions,
  checkpoints streams, and publishes ephemeral presence.
- `src/MarkdownWorkspace.tsx` is the React editing experience.
- `INNOVATIONS.md` records the reconciliation decisions that became Mosaic and
  the remaining production boundaries.

The template selects Mosaic's in-memory storage adapter for a zero-setup demo.
Production deployments should provide a linearizable storage adapter, document
ACLs, rate limits, and metrics as described in `INNOVATIONS.md`. Keep the
same-origin contract in your deployment by forwarding `/socket.io` to the
collaboration service at the edge.
