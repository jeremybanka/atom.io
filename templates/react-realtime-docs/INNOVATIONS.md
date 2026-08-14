# Mosaic Reconciliation Notes

This template began as an application-local experiment. The collaboration
machinery now lives in atom.io's Mosaic module, but Mosaic is not a parallel
state system: the document is a transceiver held by an ordinary mutable atom.
That atom token is its network address, its read-only view feeds ordinary
selectors and renderer hooks, and each Store owns the optimistic replica bound
to it. The server registers the same transceiver class as the authority for that
address. The decisions below are the places where this transceiver deliberately
takes a different path from rigid state proxying and whole-value time travel.

## Bounded Sequence Intervals

A shared string is not a useful conflict unit. Mosaic Text represents Unicode
graphemes as stable nodes and edits as insert/delete operations. Each insertion
records both its retained left boundary and its retained right boundary. The
second boundary matters: a predecessor-only graph can move a middle replacement
after the old suffix merely because one author's operation ID sorts later.
Bounded intervals preserve the user's edit location while deterministic,
code-unit ID ordering resolves genuinely concurrent insertions.

Deletes are edit-owned visibility marks. Hidden nodes remain as anchor stubs, so
foreign descendants, late operations, and relative selections do not lose their
position when an author undoes the edit that introduced an ancestor.

The model uses the host's Unicode grapheme segmenter. A deployment with
heterogeneous ICU versions should pin runtimes together or ship a versioned
segmenter before claiming cross-runtime model-version equivalence.

## Selective, Per-Identity History — Not a Timeline

Whole-document time travel is unsafe in a shared editor: restoring yesterday's
string can erase another person's accepted work. Mosaic records edit ownership
and represents undo and redo as durable operations that deactivate or reactivate
only one authenticated actor's current edit group. A foreign insertion anchored
inside hidden local work remains visible.

Atom.io's native timelines still mean local graph time travel. The Mosaic text
transceiver is marked append-only and cannot be attached to one: rewinding its
object would bypass the accepted operation stream and clobber collaboration.
Its actor-scoped capability is named `historyFor`, and undo/redo append normal
operations that every replica reduces in the same order.

The server validates the actor's current history cursor through the text
transceiver immediately before the append. A stale tab therefore fails closed
and resnapshots. Accepted revisions
are durable reduction metadata, so concurrent history operations have one
canonical order; provisional client projections explicitly use no revision.
This is exact at operation ownership and intentionally best-effort at recovering
the prose-level intention behind arbitrary concurrent rewrites.

## Relative, Ephemeral Presence

Numeric caret offsets become stale after any preceding edit. Mosaic presence
uses left/right node anchors plus an explicit affinity. The text model resolves
those anchors against each local projection, including hidden anchors. Presence
is schema-checked and model-checked, but never enters the durable operation log
or a user's history. Explicit departure and disconnect both remove the exact
actor/session record.

## Durable Stream Before Fan-Out

The server never acknowledges or broadcasts an operation before persistence.
Its adapter contract atomically compares the expected revision and reserves the
atom-stream/operation-ID receipt. A reused ID with different normalized content is
a collision, not an idempotent retry. Receipts survive checkpoint compaction.

Horizontal notifications are wake-up hints only. Every server drains a checked,
contiguous tail from the shared linearizable store. Recovery hydrates one
consistent checkpoint and then applies every later revision. Checkpoint
installation, tail pruning, session watermarks, and a retention epoch form the
compaction fence. Text model version 1 retains stable node stubs; a future model
that removes them will need an explicit anchor-translation protocol.

The template uses the in-memory adapter so it runs without infrastructure. It is
restart-safe only while that adapter instance survives. Production should supply
a transactional database implementation and define an offline-session retention
policy before pruning operation bodies.

## Optimistic Reconciliation and Recovery

Each Atom.io Store creates stable session-scoped operation IDs, applies locally,
and retains one causal outbox for the mutable atom token. Multiple components in
that Store share the same replica; a second Silo gets a genuinely independent
replica. Reconnect snapshots report which pending IDs were already accepted and
the authoritative causal frontier; the client hydrates the transceiver
checkpoint, removes those proposals, and replays the rest from that frontier.
Duplicate delivery is harmless. A revision gap resnapshots.
Structured rejection policies distinguish retryable work from stale history or
invalid dependency chains, which are quarantined rather than left as impossible
optimistic state.

Local wall-clock time may group typing gestures. It is deliberately absent from
accepted reduction semantics, fingerprints, and convergence decisions. Local
signals created inside an Atom.io transaction are observed only after commit;
aborted transaction clones are discarded before they can enter the network
outbox.

## Testing Arbitrary Protocols

Mosaic is not implemented as push/pull state proxying, yet atom.io's realtime
test harness can exercise it because the harness exposes the transport and
lifecycle rather than assuming a particular protocol. The template's
multi-client scenarios run independent React stores and Socket.IO sessions,
disconnect both editors, accept simultaneous offline work, verify selective
history, and verify presence removal. Core suites add deterministic drop,
duplicate, reorder, restart, multi-node, checkpoint, and session-correlation
schedules.

The remaining seam is application work tracking: integrations that schedule
work beyond transport callbacks should register that work with the harness when
they need barrier-based quiescence. Mosaic's conformance suite otherwise uses
the same public server, client, and renderer APIs as this application.
