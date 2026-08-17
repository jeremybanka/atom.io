# Collaborative SVG Model Decisions

This template is the model-level fixture beneath Atom.io's collaborative vector
design vertical. The same ordinary atoms, families, selectors, and transactions
remain useful in a local editor and are now registered directly in a public
Mosaic Domain.

## Durable Shape

Path order, path entities, subpath order, subpath entities, nodes, and edges are
separate ordinary Atom.io states. Drawing is a selector projection. There is no
SVG registry in the renderer or in realtime core.

Order members use rational ranks and immutable, idempotent operations. Concurrent
placements at the same rank use stable entry identity as their tie-breaker.
Geometry and entity members use deterministic last-operation-wins registers.
Both reducers are independent of delivery order, reject operation-ID collisions,
and publish strict Zod schemas for the future MOS-11 member-model hook.
Register receipts remain in the fixture state so that reuse of a superseded
operation ID still fails closed regardless of delivery order. The reducers and
their Standard-Schema operation boundaries register directly with the public
Domain member-model API. Bounding retained receipts is deliberately reserved
for MOS-16 model-aware compaction.

The local structural operations are transactions. Import validates the complete
fixture before writing. Insert, delete, split, and reorder update every required
member and its order state within one observable settlement. The invariant
selector reports duplicate references, absent entities, wrong ownership, absent
node or edge registers, and invalid close-node pairs.

## Gesture and Presence Boundary

One pointer-down creates one actor/session-scoped gesture identity backed by a
logical clock. All member operations produced by that gesture derive stable,
totally ordered operation identities from it.

Pointer moves update only ephemeral presence in SVG document coordinates. The
ordinary drawing selector projects that preview for immediate feedback. Pointer-up
coalesces the entire drag into one durable geometry transaction; cancellation
drops the presence and writes nothing durable. Rejection still releases local
pointer and presence state. A disconnect can therefore expire the preview rather
than leaving partially committed geometry.

DOM references, the actual pointer-capture owner, active drag, zoom, pan,
selection, and workspace state have explicit local atoms. Presence is keyed by
logical actor and session, so concurrent sessions for one identity cannot
overwrite or clear each other. It carries a logical resource target and
coordinates, never a DOM identity or client viewport coordinate.

## Why This Takes Its Own Path

The public Mosaic Domain contract classifies and addresses members, and its
atomic heterogeneous batches invoke registered per-member convergence models.
This fixture plugs synchronous pure reducers and Standard-Schema-compatible
operation schemas into those public seams without inventing a private batch
envelope or registration system.

The current `OList` transceiver is intentionally not used for collaborative
ordering. Its index-based mutations are useful locally but do not by themselves
converge when concurrent operations arrive in different orders. Rational order
operations make the required contention behavior executable while remaining
ordinary atom values.

## Domain Batches and Observation

`svg-domain.ts` registers path order, paths, subpath order, subpaths, nodes, and
edges as durable Domain members with their public value models. Import, insert,
delete, split, reorder, and coalesced geometry commits plan explicit public
member operations and submit one heterogeneous batch carrying the stable gesture
ID. The application does not maintain a parallel registry.

Complete preflight precedes a single Store settlement. A rejected final member
therefore rolls back the whole optimistic gesture, and the invariant selector
never observes an accepted subpath order entry without its entity, node, and
edge. Duplicate delivery is idempotent. Offline work remains a complete pending
batch and replays after recovery.

Independent node families settle independently. Same-node register operations
retain immutable receipts and choose by stable operation identity, so arrival
order and a durable mutex do not affect the result.

## Selective Compensation

Undo does not rewind an Atom.io timeline. Each reducer can accept a compensation
receipt naming exact earlier operation IDs to hide. The editor records only its
own successfully submitted gestures and appends all receipts for one undo in one
new batch. Later foreign operations remain candidates and therefore remain
visible.

Every Domain operation also carries its claimed actor. The member model compares
that actor with authenticated batch context and permits compensation targets only
when their retained receipt belongs to the same actor. A client cannot construct
a compensating batch that hides another participant's work.

## Generic Presence Innovation

MOS-11 supplied durable batching but no public ephemeral controller. This work
adds a generic Mosaic Domain presence protocol, client, server, and Socket.IO
adapter rather than hiding an SVG-specific event channel in the template.

Presence addresses public ephemeral members and passes their Standard Schema
boundary. The server binds authorship to the authenticated actor and session,
requires a monotonically increasing session sequence, and retains cleared
session cursors so a delayed update cannot resurrect a preview. One physical
presence address has one live actor-session owner; separate sessions for one
actor use separate family keys and cannot overwrite or clear each other.

Payload size, update rate, live session count, client queue, server queue, and
socket request queue are bounded. Disconnect and expiry publish monotonic clear
envelopes, do not append durable history, and expose cleanup subscriptions plus
an explicit quiescent-session retirement hook for future residency work.

The SVG projection carries only logical target identity and document
coordinates. DOM nodes, pointer capture, active drag, viewport, zoom, and
workspace state remain local atoms. Pointer moves update ephemeral presence;
pointer-up contributes at most one durable geometry operation.
Presence publication is advisory: a transient transport failure updates the
controller's status but never aborts a local drag or its durable commit. Disposing
the controller immediately removes every ephemeral projection it owns, so a
recreated client cannot briefly display a cursor or preview from its predecessor.

## Executable Conformance and Remaining Gates

The local suite covers every structural planner, settled invariants, independent
and contended geometry, malicious foreign compensation, whole-batch rejection,
offline replay, and selective undo. The `atom.io/realtime-testing` suite drives
real Socket.IO clients through the public Domain, server, client, batch, and
presence seams. It covers duplicate delivery, final-member rejection, offline
replay, same-node contention, and disconnect during drag.

Partial residency, checkpoint recovery, and process restart remain explicitly
gated on MOS-12 and MOS-13. The canonical multiplayer renderer remains MOS-23.
