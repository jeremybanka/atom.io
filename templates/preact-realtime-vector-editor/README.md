# Plane: Preact realtime vector editor

Plane is a deliberately small collaborative path editor. It is a canonical example of a design application built on an Atom.io Mosaic Domain rather than a parody of any product surface.

Run `npm run dev`, then open two tabs. Choose different simulated identities from the header. Vite proxies both health and Socket.IO traffic to the Node service, so the browser always connects through `window.location.origin`.

The identity picker is an exploration aid, not authentication: any client can claim one of the allowlisted demo actors. Before deployment, derive actor and session identity from verified credentials and supply an application authorization policy to the collaboration service.

The canvas supports node dragging, atomic node insertion and deletion, private zoom, advisory focus, lossy remote pointers and drag previews, actor-selective undo and redo, offline replay, and visible pending or rejected work. The local-only `preact-svg-editor` remains the smaller atoms, families, selectors, and transactions tutorial.

Read `INNOVATIONS.md` before adapting the example. It names the correctness boundaries and the places where this template intentionally takes an application-specific path.

Read `CREATE_COMPATIBILITY.md` for the executable Create-* support-contract fixture and the boundary between Atom.io, a consumer adapter, and the product.

## Quality Checks

Run `npm run lint` before committing. It enforces ESLint, type-aware Oxlint, React hook call-order correctness, TypeScript, and CSS-module reachability with zero warnings. Run `npm run fmt:check` in CI and `npm run fmt` to apply the pinned dprint configuration locally.
