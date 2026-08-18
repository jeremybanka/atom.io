# Innovations and boundaries

## One model, two teaching surfaces

The local SVG tutorial and Plane import the same ordinary path-order atom, path and subpath families, node and edge families, rendering selectors, deterministic member reducers, Domain definition, and gesture editor. The template package now exposes those seams through explicit subpaths. Plane adds collaboration and product UX; it does not maintain a second vector convergence model that could drift.

## Durable Mosaic members

Path order, subpath order, paths, subpaths, nodes, and edges are durable Domain members. Each pointer-up produces at most one geometry operation. Insert and delete gestures are heterogeneous batches, so a rejected final member cannot expose a structural hole. Ordinary selectors remain the SVG rendering interface.

The application treats same-node focus as advisory. It does not acquire a correctness lock. Concurrent register operations settle deterministically; the losing client sees the converged result. Disjoint member edits do not contend.

## Presence is lossy and session-scoped

The generic collaborator member carries simulated identity, active path, logical-coordinate pointer, and selection. The existing drag-presence member carries the active gesture target and preview. Both are ephemeral, authenticated by actor and session, absent from durable history, and cleared by disconnect or expiry. DOM elements, pointer capture, zoom, pan, and workspace layout never enter either presence payload.

Here, “authenticated” means bound to the actor and session accepted by the Domain controllers. The template handshake only allowlists its simulated actors and can be impersonated; it is not a production identity system. A deployed application must derive those values from verified credentials and supply its own batch authorization policy.

The UI publishes pointer movement without waiting for acknowledgement. This favors current information over a false guarantee that every intermediate frame matters. Pointer-up is the durable boundary.

## Actor-safe history

Undo emits an authenticated compensating batch targeting only the actor's own operation receipts. Foreign operations remain active. Plane adds redo as a compensation of that compensation rather than replaying a fresh last-writer operation; this preserves foreign edits. To support nested compensation correctly, the SVG reducers now determine whether a compensation is itself active before hiding its target.

This history is intentionally session-memory UX. Durable operation receipts enforce safety, but a browser reload does not reconstruct a personalized undo menu. A production design tool may persist an actor-specific command index without making it shared document state.

## Recovery and restart

The Node service accepts a `MosaicDomainCheckpointStorageAdapter`. It serializes proposals with checkpoint publication so the coordinator's member reads belong to the exact accepted revision it is publishing. A fresh server generation reconstructs the Domain from the adapter before serving recovery. The conformance suite preserves the storage adapter across a realtime-testing restart, recovers a selected node from the published content-addressed graph, and proves that fresh clients converge from durable history.

This small template keeps the complete drawing resident and uses the reference in-memory checkpoint adapter. Large design applications should provide durable storage and application-defined partial-residency cuts over the same public checkpoint graph. That scale policy belongs outside the vector member reducers.

## Renderer-neutral runtime, React-shaped test fixture

The shipped application renders with Preact. The current `multiClient` rendered fixture is built around Testing Library's React renderer, so React and ReactDOM remain test-only dependencies while the fixture drives the same Socket.IO client runtime used by Plane. This is an adapter tax rather than an application constraint: a future renderer hook in `@atom.io/realtime-testing` can remove it without changing the protocol or assertions.

## Same-origin transport

The browser connects to its current origin. Vite proxies `/socket.io` and `/health` to the Node process in both development and preview. The transport names are application protocol, while validation, atomic settlement, recovery, presence expiry, and actor authorization remain public Atom.io controllers.
