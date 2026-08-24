# Innovations and boundaries

## Integrity is the model boundary

Plane's durable object is one closed contour value. It contains an ordered list of three to sixty-four uniquely identified finite points. The renderer joins adjacent points and closes the final point to the first. There is no durable edge registry, path order, subpath order, curve control, or close command.

That representation removes an entire class of reconciliation bugs. Every node has exactly two implicit neighbors. Branching, dangling edges, missing close operations, cross-member identity mismatches, and partially undone structural batches have no representable object state.

The schema validates proposals, checkpoint hydration, and direct reducer use. The reducer parses before accumulation, so application code cannot bypass integrity by calling it locally.

## One durable member and complete history states

The `contour` member is a deterministic register of complete validated contour snapshots. A pointer-up, insertion, deletion, or replacement contributes one operation to that member. Undo and redo compensate only the authenticated actor's operations, then materialize another complete validated snapshot. Foreign snapshots remain active.

The collaboration regression exercises the failure that motivated this design: one actor inserts a node, another actor moves that node, and the creator undoes the insertion. The participating actor's complete contour remains visible and valid. Undoing that participation returns to the valid default contour. The test checks the server and both clients and proves every visible node has degree two.

The deliberate tradeoff is coarse contention. Simultaneous gestures based on the same contour are complete alternatives, and deterministic register order chooses one. This small example prefers an obvious integrity boundary over teaching an application-specific operation algebra. A product that needs disjoint contour edits to merge should define a single contour model whose operations replay into a validated contour; it should not split topology across independently undoable members.

## The richer SVG tutorial stays separate

The local `preact-svg-editor` still demonstrates paths, subpaths, line and cubic edges, ordering, and local transactions. Plane uses the constrained `./contour` export from that package. This keeps the reusable contour schema, reducer, Domain, and editor in one module without pretending that the Bezier tutorial's representational freedom is safe for this collaborative product.

The legacy multi-member editor also adopts the complete subpath when a participant reorders it. That compatibility hardening prevents a foreign order receipt from outliving the creator's subpath, node, and edge receipts. Plane does not rely on that repair; its normal path has no independent order or edge members.

## Presence is lossy and session-scoped

Collaborator presence carries simulated identity, logical-coordinate pointer, and selected node ID. Drag presence carries one node ID and preview point. Both are ephemeral, authenticated by actor and session, absent from durable history, and cleared by disconnect or expiry. DOM elements, pointer capture, zoom, pan, and workspace selection remain local.

Here, “authenticated” means bound to the actor and session accepted by the Domain controllers. The template handshake only allowlists simulated actors and can be impersonated. A deployed application must derive those values from verified credentials and provide its own batch authorization policy.

The UI publishes pointer movement without waiting for acknowledgement. Pointer-up is the durable boundary.

## Recovery and restart

The Node service accepts a `MosaicDomainCheckpointStorageAdapter`. It serializes proposals with checkpoint publication so member reads belong to the accepted revision being published. Checkpoint compaction keeps the visible contour and protected receipts, and a fresh server generation reconstructs the same validated contour before serving recovery.

This template keeps one small contour resident and uses the reference in-memory checkpoint adapter. Large design applications should provide durable storage and application-defined residency cuts. Scale policy belongs outside the contour reducer.

## Renderer and transport boundaries

The shipped application renders with Preact. Its `multiClient` fixture uses Testing Library's React renderer to drive the same Socket.IO client runtime, so React and ReactDOM remain test-only dependencies.

The browser connects to its current origin. Vite proxies `/socket.io` and `/health` to the Node process in development and preview. Event names are application protocol; validation, atomic settlement, recovery, presence expiry, history, and actor authorization remain public Atom.io controllers.
