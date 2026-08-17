# Collaborative SVG Model Decisions

This template is the model-level fixture beneath Atom.io's collaborative vector
design vertical. It deliberately stops before networking. The same ordinary
atoms, families, selectors, and transactions remain useful in a local editor and
in a Mosaic Domain.

## Durable Shape

Path order, path entities, subpath order, subpath entities, nodes, and edges are
separate ordinary Atom.io states. Drawing is a selector projection. There is no
SVG registry in the renderer or in realtime core.

Order members use rational ranks and immutable, idempotent operations. Concurrent
placements at the same rank use stable entry identity as their tie-breaker.
Geometry and entity members use deterministic last-operation-wins registers.
Both reducers are independent of delivery order, reject operation-ID collisions,
and publish strict Zod schemas for the future MOS-11 member-model hook.

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
drops the presence and writes nothing durable. A disconnect can therefore expire
the preview rather than leaving partially committed geometry.

DOM references, the actual pointer-capture owner, active drag, zoom, pan,
selection, and workspace state have explicit local atoms. Presence carries a
logical resource target and coordinates, never a DOM identity or client viewport
coordinate.

## Why This Takes Its Own Path

The current Mosaic Domain contract can classify and address members, but MOS-11
is adding atomic heterogeneous batches and per-member convergence models. This
fixture exposes synchronous pure reducers and Standard-Schema-compatible
operation schemas without inventing a private batch envelope or registration
system. Once MOS-11 lands, these seams should plug into its public member model
metadata.

The current `OList` transceiver is intentionally not used for collaborative
ordering. Its index-based mutations are useful locally but do not by themselves
converge when concurrent operations arrive in different orders. Rational order
operations make the required contention behavior executable now while remaining
ordinary atom values.

## Gated Remainder

The following work remains part of MOS-22 after MOS-11 and the persistence
foundations are available:

- register every durable and ephemeral member through the public Mosaic Domain
  API and submit each structural gesture as one domain batch;
- validate final-member rejection, duplicate delivery, offline replay, and
  same-node contention through public server/client APIs;
- add actor-selective undo as one compensating batch while preserving later
  foreign work;
- exercise disconnect during drag, partial residency, checkpoint, and restart
  with the multi-client realtime-testing topology;
- consume the finished model in the canonical realtime vector-editor template.

These are integration gates, not responsibilities silently implemented by this
local fixture.
