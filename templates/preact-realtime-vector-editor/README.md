# Plane: Preact realtime contour editor

Plane is a deliberately small collaborative editor for one closed, straight-line contour. It demonstrates a design application built on an Atom.io Mosaic Domain without asking a tutorial model to carry paths, subpaths, curves, edge handles, and independent topology registries.

Run `npm run dev`, then open two tabs and choose different simulated identities from the header. Vite proxies both health and Socket.IO traffic to the Node service, so the browser connects through `window.location.origin`.

The identity picker is an exploration aid, not authentication. Before deployment, derive actor and session identity from verified credentials and supply an application authorization policy to the collaboration service.

The canvas supports node dragging, node insertion and deletion, private zoom, advisory focus, lossy remote pointers and drag previews, actor-selective undo and redo, offline replay, and visible pending or rejected work. A contour always has three to sixty-four uniquely identified finite points. Straight edges and closure are implicit, so a dangling edge, branch, curve, or node with degree other than two cannot be represented.

The separate `preact-svg-editor` application remains the richer local Bezier tutorial. Plane imports its constrained contour module instead of putting that richer topology into a collaborative Domain.

Read `INNOVATIONS.md` before adapting the example. It explains why the integrity boundary is one durable aggregate, what selective history can expose, and the deliberate concurrency tradeoff of this spartan model.
