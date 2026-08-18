# Create-* compatibility contract

This fixture validates a representative Create-* state shape against public Atom.io Mosaic Domain APIs. It supports the integration planning in [create-font #522](https://github.com/jeremybanka/create-font/issues/522) and [create-font #525](https://github.com/jeremybanka/create-font/issues/525). Those product issues remain the authority for Create-* security, persistence, and UX; this template does not accept every product recommendation as an Atom.io core requirement.

## Executable mapping

| Create-* concern                                   | Fixture representation                                      | Ownership                                               |
| -------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------- |
| Glyph or top-level path order                      | The durable SVG path-order atom                             | Atom.io state plus the shared SVG order model           |
| Glyph and contour identity                         | Durable path, subpath, and order atom families              | Atom.io state plus the shared SVG register/order models |
| Point and control geometry                         | Durable node and edge atom families                         | Atom.io state plus the shared SVG register model        |
| Multi-glyph gesture                                | One batch updates nodes and cubic controls in two glyphs    | Public Mosaic Domain batching                           |
| Render projection                                  | The ordinary path-drawing selector family                   | Application state graph                                 |
| Active glyph, selection, viewport, pointer capture | Ordinary local atoms, different in every Silo               | Application state graph                                 |
| Collaborator pointer and active glyph              | Ephemeral actor/session presence in logical SVG coordinates | Public presence controller plus an application payload  |
| Viewer/editor mutation policy                      | The server authorization callback                           | Consumer adapter                                        |

`CREATE_COMPATIBILITY_SURFACE` is a compile-time compatibility fixture over these public tokens. `createCreateCompatibilityAdapter` converts one representative multi-glyph command into public batch operations. Neither defines a replacement transport or convergence protocol.

## Responsibility boundary

| Supplied by Atom.io                                                                                                                                                                               | Supplied by a Create-* adapter                                                                                                                                                                              | Owned by Create-*                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Domain identity, normalized member addressing, atomic batch validation, authorization hook, optimistic reconciliation, recovery, checkpoints, ephemeral presence lifecycle, and connection status | Mapping product IDs and commands onto members, registered action schemas, roles onto authorization decisions, logical product presence payloads, checkpoint/storage adapters, and source-durability fencing | Verified Git/device identity, host admission and revocation, invitations, certificate pinning, loopback gateway, LAN policy, source-service transactions, repository observation, product history policy, and all user-facing security/status UX |

Authentication, admission, and authorization are separate decisions. Plane's allowlisted simulated identity only demonstrates an actor/session binding and can be impersonated. The fixture's authorization callback proves role enforcement after a client has been admitted. It does not claim to implement Create-* device proof or host approval.

Durable collaboration, ephemeral presence, and local editor state are also separate. Geometry and structure enter accepted Domain batches. Pointers and drag previews may be lost and expire by session. Selection, viewport, active tool, DOM references, and pointer capture never leave the client's Silo.

## History policy

Mosaic's SVG model can express actor-selective compensation and keeps foreign operations active. The current Create-* product issues instead specify server-owned, scope-shared timeline undo and intentionally disable offline document replay. Both policies can consume the same Domain identity, member, batch, presence, checkpoint, and authorization foundations.

The compatibility fixture therefore does not impose Plane's undo menu or offline UX on Create-\*. A Create-\* adapter must choose and test its product history and disconnected-editing policy explicitly. It must not translate local Atom.io timeline rewinds directly into unauthenticated network commands.

Compensation graphs fail closed when cyclic. A review suggestion to treat a cycle as inactive was rejected because that would silently choose a document interpretation for corrupt history.

## Review-derived transport invariants

MOS-23's review established reusable requirements for consumers:

- Every request acknowledgement has a typed success or failure result, including thrown proposal and recovery work. A client must not wait forever on an exceptional server path.
- Initial startup and reconnection run the same synchronization workflow: recover batches, flush queued work when product policy permits it, start presence, and refresh ephemeral state.
- Compensation-cycle corruption is surfaced rather than guessed through.
- Simulated identity is never described as production authentication.

MOS-24 inherits these invariants by using Plane's collaboration client and service rather than adding another Socket.IO protocol.

## Compatibility proof

The multi-client test creates two already-admitted, independent rendered clients through `@atom.io/realtime-testing`, grants one actor editor authority and one actor viewer authority, and seeds two glyph-shaped paths. The editor moves selected points and cubic controls across both glyphs in one revision. Both clients converge through ordinary selectors, while their workspace and viewport atoms stay independent. Logical-coordinate presence crosses clients without entering durable state. The viewer's attempted mutation is rejected and its optimistic projection is removed.

This is intentionally a narrow contract test, not a miniature Create Font implementation. Complete source persistence, external filesystem reconciliation, timeline-family policy, LAN transport, route authorization, device identity, and admission UI remain in the linked Create-* issues.

## Explicit non-goals

- `.gitconfig` discovery or device-key provisioning
- LAN certificates, invitation encoding, gateways, or host-approval UI
- Font compilation, source-file formats, repository mutation, or filesystem observation
- A font-specific Mosaic member type or a Create-* branch in the generic Domain core
- A second SVG convergence model
- Complete Create Font or Create Design product behavior
