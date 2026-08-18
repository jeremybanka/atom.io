---
slug: mosaic-domain
title: Mosaic Domain
summary: A Store-owned coordination boundary over ordinary atom.io state.
packages:
  - atom.io
  - atom.io/realtime
related:
  - atom
  - atom-family
  - selector
  - silo
  - transceiver
---

A Mosaic Domain describes which parts of an atom.io state graph participate
in one collaboration protocol. The declaration API is
`mosaicDomain()`. It does not create another state graph or wrap its
members in special resources. Its members are ordinary atoms, atom families,
and selectors, so core APIs and the existing React and Solid hooks continue to
read and write them directly.

<Exhibit src="realtime/declare-a-mosaic-domain.ts" />

The domain definition is Store-independent. Activating it validates its
configuration with Standard Schema, checks that every member belongs to the
target Store, reserves its durable members, and returns a disposable instance.
This makes equivalent definitions usable in the implicit Store, an application
Silo, or an isolated headless test Silo.

Definition identity, domain-instance identity, and configuration have
different jobs:

- The definition key and version identify wire-visible schema and protocol
  behavior. Change the version when parsing, convergence, addressing, or other
  replicated behavior changes.
- The instance identifies one particular shared resource, such as one document
  or design project. Every transport address carries it.
- Configuration is validated activation input for deployment and controller
  setup. It is not part of an address and must not silently change replicated
  semantics. A synchronization controller must negotiate any configuration that
  peers need to agree upon; that negotiation arrives with domain batches.

One definition can have only one active instance in a Store. Use a separate
Store or Silo when a process needs another instance of that definition. This
keeps ordinary atom identities unambiguous while allowing transport routers to
distinguish instances hosted in different Stores.

## Ownership

Atoms still own values, effects, subscriptions, and family-member disposal.
Selectors still own derivation. A Mosaic Domain owns only the
coordination metadata needed by a collaboration transport: identity, protocol
version, instance identity, validated configuration, named members, addresses,
and durable ownership claims.

Each durable atom address can belong to at most one active Mosaic Domain in
a Store. A durable family declaration is intensional: it claims the family
pattern rather than enumerating its current members. Members created later are
therefore covered, and another domain cannot claim either the same family
or one of its individual members. Claims are local to a Store and are released
when the instance is disposed. Clearing the Store also disposes all of its active
Mosaic Domain instances.

Activation is atomic. Invalid configuration, a missing Store member, or any
ownership conflict leaves all proposed claims unowned.

## Member roles

<table-wrapper>
  <table>
    <thead>
      <tr>
        <th>Role</th>
        <th>Ownership and lifecycle</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><code>durable</code></td>
        <td>
          Replicated application state. The domain reserves exclusive
          durable ownership and exposes a Standard Schema for untrusted values.
        </td>
      </tr>
      <tr>
        <td><code>local</code></td>
        <td>
          Store-local application state, such as a local selection or draft.
          It participates in application composition without receiving a
          transport address or being accepted from a remote peer.
        </td>
      </tr>
      <tr>
        <td><code>derived</code></td>
        <td>
          Selectors derived from collaborative and local members. Derivation
          remains entirely inside the ordinary atomic state graph. Derived
          members do not receive transport addresses.
        </td>
      </tr>
      <tr>
        <td><code>ephemeral</code></td>
        <td>
          Validated, non-durable collaborative state such as presence. It does
          not receive an exclusive durable claim.
        </td>
      </tr>
    </tbody>
  </table>
</table-wrapper>

Durable and ephemeral value schemas, family-key schemas, and the configuration
schema are validation boundaries. The domain does not validate ordinary
local writes. Only durable and ephemeral members are remotely addressable. Local
and derived members remain available through the instance's ordinary member map
for application composition, but cannot masquerade as transport resources.

For a regular atom, the value schema produces the atom's value type. For a
mutable atom, it produces the serializable snapshot returned by the
transceiver's `toJSON` method. Mosaic operation validation remains the Mosaic
model's responsibility; a domain does not replace that operation protocol
with snapshot writes. Batching and synchronization layers can therefore choose
the appropriate payload policy without weakening this domain's state and
address schemas.

## Addresses and residency

An active instance creates serializable member addresses from the domain
definition, version, instance, logical member name, and, for a family, its
canonical key. Parsing an untrusted address verifies all of those fields and
validates a family key without minting or hydrating the family member. Singleton
addresses reject keys. Acquisition is a separate, explicit operation that may
materialize a validated family member in the Store.

The address contract is intentionally transport-neutral. It establishes the
Store, schema, and allocation boundary that authorization, persistence, routing,
batching, ordering, reconciliation, and presence layers can build on without
moving application state out of atom.io.

Activation is intentionally actor- and session-neutral. Synchronization
controllers bind authenticated actors and fresh connection sessions to an active
instance, and domain batch envelopes carry those identities. A server can
therefore serve many sessions through one Store-owned instance without putting
authentication into state declaration.

## Granularity

A one-atom domain is first-class and useful for comments, snippets, and
other small collaborative values. MosaicText remains a good mutable-atom value
for bounded collaborative text with per-participant history.

Large documents should use a domain whose atom families partition the
model into bounded members. Because family membership is intensional, activating
the domain does not enumerate or materialize the whole document. This
contract establishes that scalable shape; synchronization and reconciliation
layers decide when particular members are loaded and exchanged.

Mosaic Text can prepare a logical selection replacement without materializing
or mutating the accepted document. Its preview exposes the next visible runs so
an authoritative composer can derive bounded index maintenance before
submitting both operation families in one Domain batch. Streaming Unicode
chunking remains inside Mosaic Text; an application supplies one logical string
and does not manufacture CRDT runs or storage shards.

<Exhibit src="realtime/prepare-logical-text-edit.ts" />

## Atomic batches

A durable member may register a deterministic batch model. Value models pair a
Standard Schema operation boundary with a pure reducer. Existing Mosaic
transceiver models can instead register their constructor and operation schema;
preflight clones their serializable checkpoint before asking the model to
validate and reduce an operation.

Standard Schema outputs, rather than their untrusted inputs, become the accepted
member addresses, operations, and resulting values. The server authorizes,
stores, and broadcasts that normalized envelope so peers never repeat a lossy
or environment-sensitive input coercion after acceptance. Family-key and
operation schemas must normalize idempotently; preflight rejects schemas whose
output changes when validated again at an authoritative replay boundary.

<Exhibit src="realtime/coordinate-a-domain-batch.ts" />

One call to the batch client's submission method accepts either one operation or
an array. Both forms prepare and settle through one ordinary atom.io
transaction, so an application does not choose between a single-operation API
and a transaction API. Model reduction and resulting value validation finish
before the Store is mutated. If any address, key, model, operation, or final
value fails, no local notification or outbound proposal is produced.

The wire envelope identifies the exact Domain definition and instance, protocol
version, authenticated actor, session, gesture group, dependencies, batch ID,
affected addresses, and individually identified member operations. The server
resolves and preflights the complete envelope before whole-batch authorization.
Its storage adapter then reserves the next Domain revision, batch ID, and every
operation ID in one atomic append. Only an accepted append is settled and
broadcast. Retries with identical authenticated content return the original
receipt; reuse with different content fails closed.

Optimistic client settlement preserves the batch boundary. A rejection rolls
back all of its resident members in one Store transaction. Foreign acceptance
while local work is pending reduces the confirmed batch and replays complete
pending batches off-Store, then reveals the entire replacement through one
ordinary Store transaction. This also replaces provisional metadata with the
authoritative revision without exposing a transient rollback frame. Revision
gaps recover and project a contiguous accepted tail before later work is made
visible. Offline proposals remain whole and are resent idempotently after
recovery. New edits made while offline stay behind earlier pending batches.
Invalid transport acknowledgements and conflicting accepted IDs discard the
entire optimistic projection in one transaction before resnapshot recovery;
they cannot leave non-applied pending handles in the queue.

Mixed value and transceiver batches required one generic transaction repair.
When a transaction writes through a mutable atom's JSON proxy, atom.io now
retains a serializable mutable-snapshot subevent and publishes that replacement
with the rest of the transaction. Previously the child Store held the new
transceiver while the committed transaction omitted it. Keeping this mechanism
in the ordinary transaction event model lets Domain reprojection atomically
replace append-only transceiver checkpoints alongside regular atoms without a
Mosaic-only state registry.

Per-proposal byte, distinct-member, operation-count, and pending-queue limits
bound validation and backpressure. They do not impose a Domain or document-size
limit. Applications scale total state by using bounded atom-family members.

## Partial residency

The headless residency controller projects an unbounded durable family address
space into a bounded set of members in one client Store. Acquisition first
normalizes an address and asks the server to authorize and hydrate it. Only a
successful checkpoint may materialize the family member. Disposable leases are
reference-counted: releasing one consumer cannot evict a member that another
consumer still owns, and eviction is distinct from release.

<Exhibit src="realtime/coordinate-partial-residency.ts" />

Member and range subscriptions share one filtered transport scope. An accepted
batch carries operations only for the resolved scope, plus bounded metadata and
a revision token for each request. When several affected members are resident,
their filtered operations settle in one ordinary Store transaction. Other
addresses are never acquired merely because the same durable batch mentions
them. Range invalidations cause a fresh, consistent hydration cut instead of
guessing membership from a partial address list.

Range descriptions are application-defined JSON validated through an injected
Standard Schema. The server authorizes the normalized range before consulting
its resolver and then authorizes every normalized result before value lookup.
Direct member lists are capped before address parsing, while range inputs and
normalized outputs have byte and depth limits before canonicalization. This
keeps authorization, schema validation, and resolver work ahead of Store
allocation without accepting an unbounded request tree. The client's catch-up
buffer is bounded too; overflow discards the partial buffer and takes a fresh
checkpoint rather than applying an unknowable suffix.
The resolver is deliberately an adapter seam: MOS-15 can supply a durable
spatial or ordered index without putting index policy into the Domain core.
Likewise, hydration returns a checkpoint-shaped cut with an opaque revision
token, allowing MOS-13 to replace tail-derived snapshots without changing the
client lifecycle.

Release stops requesting a member but leaves its cached Store value until
explicit eviction. Reacquisition always rehydrates before declaring the member
current. Physical member count and estimated durable bytes include released
caches, so configured limits remain deterministic and an application must evict
before admitting more state. A locally authored optimistic proposal remains in
the session outbox even if every affected member is released and evicted;
reconnect resends that owned work without restoring unrelated residency.

Controller disposal removes transport listeners and resident family members but
does not touch authoritative storage. A generic cleanup callback lets presence
projections and application-owned derived caches follow the same lifecycle
without embedding a second presence protocol in residency.

Store observers run only after a settlement has committed. An observer failure
is reported through the Store logger without reclassifying accepted durable work
as uncommitted or applying its reducer a second time during recovery.

## Ephemeral presence

The Domain presence controller coordinates remotely addressable `ephemeral`
members without writing the durable batch log or entering application history.
The server authenticates actor and session, resolves the Domain address,
validates the value with the member's Standard Schema, and requires a monotonic
sequence for that session. Disconnect and expiry produce monotonic clear
envelopes. Retained session cursors prevent delayed packets from resurrecting a
cleared value; a quiescent cursor can be explicitly retired when the surrounding
authentication or residency layer retires that session epoch.

<Exhibit src="realtime/coordinate-domain-presence.ts" />

One ephemeral address has one live actor-session owner. Applications normally
use an atom family keyed by logical actor and session when several collaborators
publish the same kind of presence. Two sessions belonging to one actor therefore
cannot overwrite or clear each other. Client and server controllers project
accepted envelopes into the ordinary family members declared by the Domain.

Presence has independent byte, rate, live-session, pending-update, and socket
request bounds. The Socket.IO adapters use named request, response, snapshot,
and broadcast events; the transport-neutral controllers can instead use another
authenticated transport. Server cleanup subscriptions and quiescent-session
retirement are exposed for later residency integration without making ephemeral
updates durable.

## Bounded text indexes

Long-form text uses a model-specific bounded-fanout index behind the generic
residency range seam. The root points to one node or leaf summary. Internal
nodes point to a bounded number of child summaries, and leaves retain bounded
logical run fragments. Root and node summaries carry UTF-16, grapheme, line
break, and leaf counts, so an offset, line, or bounded range reads one path
rather than materializing preceding text. A large single line or fenced block
therefore splits at the configured physical thresholds just like other text;
syntax does not become an accidental document-size limit.

<Exhibit src="realtime/index-bounded-text.ts" />

Index roots and members remain ordinary durable atoms and atom-family members.
The application persists them through the same Domain checkpoint and batch
boundaries as other state. Rebalancing retains existing leaf and node boundaries
inside configurable minimum, target, and maximum hysteresis thresholds. A
local edit usually changes one leaf, one node per tree level, and the root;
the maximum leaf size is a split threshold, not a whole-document cap.

Physical maintenance is explicitly excluded from actor-selective text history.
A cross-leaf edit, paste, or replacement submits its model operations and the
index maintenance writes as one Domain gesture, so resident selectors cannot
observe half of the structural change. Logical positions continue to name a
run and grapheme boundary rather than a leaf. Annotations, presence, and pending
proposals therefore keep their semantic anchor when a leaf splits or merges.

Short-lived aliases translate a stale leaf identity into a bounded set of
current leaves. Alias fanout and range member limits fail with a structured
range-resnapshot signal instead of returning an incomplete selection. The
server-side resolver reads the durable index and returns only the authorized
leaf addresses requested through partial residency; it does not allocate the
complete family in a client Store. UTF-16 ranges are half-open. A collapsed
caret range hydrates the leaf to its right, or the final containing leaf at the
end of the document.

The residency server can use an incremental checkpoint coordinator as its
hydration source. It then loads only requested member versions and reduces
those members through the accepted tail without acquiring unrelated family
members or reading a mutable live Store cut. Durable range indexes and
actor-selective retained history remain separate facilities built on the same
revision, resolver, and gesture boundaries.

## Incremental checkpoint graph

A checkpoint coordinator persists a Mosaic Domain as a content-addressed graph,
not one eagerly serialized Store snapshot. Its small immutable root records one
accepted Domain revision and points to bounded persistent directories for
member versions and application-defined index paths. Directory leaves and
branches have fixed fanout. Updating one member therefore writes its immutable
version plus only the directory path leading to it; every untouched subtree is
shared with the prior root.

<Exhibit src="realtime/checkpoint-a-domain-incrementally.ts" />

The coordinator derives its dirty member set from the contiguous accepted tail
since the prior root. Its member reader receives the exact target revision, and
an optional index callback returns only affected bounded paths. The coordinator
enforces limits on tail batches, dirty members, dirty index paths, and individual
object bytes. Instrumentation reports the number and bytes of objects actually
persisted, so an ordinary edit can be checked against bounded work rather than
total Domain size.

Immutable objects are staged before publication. Staging may partially succeed
or be repeated safely because no reader can reach those objects yet. Root
publication is the atomic boundary: storage verifies every referenced object
is readable and compares the accepted-stream revision, prior root, and retention
epoch in one operation. An append, another checkpoint writer, or a changed
protection set makes the attempt stale; the coordinator retries from a fresh
cut. A crash before publication leaves reclaimable orphans, while a crash after
publication leaves a complete graph.

Recovery atomically opens a protected root-plus-head view, traverses directory
paths for only the requested addresses, and returns those versions with the
contiguous accepted tail through the captured head. This prevents reclamation
from racing lazy hydration and lets two clients request disjoint working sets
without either downloading the complete Domain. Tail length is bounded; a
request beyond the supported horizon fails closed instead of constructing an
unbounded suffix.

The storage contract is vendor-neutral. Adapters expose stable-key object reads
and bounded cursor enumeration alongside the existing atomic batch append.
Session watermarks, active outboxes, retained history groups, in-flight reads,
and pending proposals use named retention leases. Garbage collection traces the
current root and every leased root, derives a tail floor from each root's own
revision as well as the lease watermark, and advances the retention epoch
atomically. It cannot delete a member version or tail still reachable by a
supported collaborator.

## Actor-selective Domain history

A Domain history coordinator turns accepted gesture groups into bounded,
actor-relative undo and redo stacks. One gesture remains one history step even
when its batch changes heterogeneous singleton and family members. An undo or
redo asks each affected member model for its own compensation operation, then
submits every compensation in one ordinary atomic Domain batch. The coordinator
never restores a prior Store snapshot, so concurrent foreign work is left in
place and ordinary Atom.io timelines remain a separate local facility.

An optional compensation-completion callback may append derived maintenance to
that same batch. This is the seam used by bounded text: the run-text model owns
the compensation while its root and leaf index maintenance remains atomically
consistent at the accepted revision. Every appended operation must be declared
history-free by its member model. The coordinator rejects a completion that
introduces a new history change or compensation, and still verifies that the
original gesture was compensated exactly.

<Exhibit src="realtime/coordinate-domain-history.ts" />

History is opt-in at the member model. A policy classifies changes,
compensations, and history-free maintenance; constructs a compensation for its
own operation language; and may fold retired operations into an equivalent
checkpoint value. The generic coordinator understands actors, sessions,
gestures, revisions, addresses, and atomicity, but it contains no text, SVG,
renderer, or application-state branch. The run-text model, for example, folds
retired actions into bounded system baselines while preserving stable
run-relative positions. Index maintenance remains explicitly excluded.

Every actor snapshot exposes a cursor and an explicit horizon: available undo
and redo counts, the oldest retained revision, and the cut before which history
was truncated. Two sessions for one actor may read the same cursor, but only
the first competing request can advance it; the other receives a structured
history resnapshot. A cursor older than the supported recovery floor instead
requires a complete Domain resnapshot. History requests and Domain proposals
carry monotonic per-session sequences, so retired arbitrary identifiers do not
require immortal receipts.

A non-null batch group is the actor-scoped, durable identity of one gesture,
not a claim that its transport batches are adjacent. The same identity remains
one history step when foreign batches interleave; an actor must use a fresh
group for a later gesture. A long gesture can therefore cross bounded payloads
without network timing changing its history boundary.

The coordinator persists its bounded actor stacks and supported session
watermarks as an application index in the incremental checkpoint graph. A
returning session therefore continues its monotonic request sequence after a
restart instead of replaying an already-retired request. At the same checkpoint
cut, model-owned
compaction receives the exact operation IDs still protected by retained
history, presence anchors, annotations, outboxes, pending proposals, and
supported sessions. Those protections also update the checkpoint retention
lease. Garbage collection may then reclaim old roots and accepted tails while a
small collision window and durable session watermarks keep retry and ID-reuse
behavior deterministic.

Supported history sessions fence their actor from stack eviction whenever an
unsupported victim exists. At actor capacity, an unsupported oldest stack is
retired first; boundedness wins only when an imported state offers no such
victim, and the resulting retired horizon requires a Domain resnapshot.
Applications register presence, annotation, outbox, and proposal references
through the protection API shown above, then release each protection with its
owner's lifecycle.

## Bounded text projections

The Store-owned text projection client turns bounded index and residency
facilities into a renderer-neutral document API. It exposes document length,
position lookup, one-shot range reads, observed range leases, logical edits,
and explicit full materialization. Range acquisition accepts overscan but is
still bounded by configured UTF-16, active-range, and resolved-member limits.
React owns only the viewport lifecycle through a hook; headless clients and a
future Solid adapter consume the same controller and ordinary selectors.

<Exhibit src="realtime/project-a-mosaic-text-viewport.tsx" />

Each live range has a selector whose truthful dependencies are one membership
atom plus the exact resident leaves returned by the normalized range request.
The membership atom is necessary because a physical leaf split or merge can
change which leaves make up a logical range without changing any previously
resident leaf value. This is the deliberate seam added beyond the original
residency contract: a subscription exposes its current normalized addresses,
and the controller can inspect already-hydrated members without acquiring a
second ownership lease. The seam remains model-neutral; the Domain core has no
text-specific branch.

Equal ranges share one Store resource and reference-counted residency request.
Overlapping ranges share hydrated family members while retaining independent
selector membership. Releasing the last view disposes its selector and
membership atom, releases the filtered request, and may evict the now-unowned
leaf cache. Thus scrolling and unmounting do not accumulate selector or Store
resources, and full-document state cannot be pulled in accidentally.
Controller identity includes the root address and range-member name, so two text
indexes in one Domain cannot accidentally share projection state. Cleanup is
best-effort across every owned resource: one failed transport release is
reported without preventing selector, membership, observer, and cache cleanup.

Projected blocks use run-relative anchors as render keys. Their identities
therefore survive physical index splits and merges, preserving React focus and
selection across maintenance. The projected text is clipped to the requested
logical half-open range even though the backing leaves are hydrated whole.

Logical edit planning stays in an application adapter because a text model's
operation language and physical routing are not generic Domain policy. One
replace submits one gesture group through residency. A model-specific edit may
temporarily select unloaded members; that selection is released even on
failure. After a submit succeeds, release trouble is logged instead of turning
an accepted gesture into a rejected edit promise that could invite a duplicate
retry.

Undo and redo take a different path. The optional history adapter delegates them
to the authoritative MOS-16 coordinator transport, which owns actor cursors,
horizons, unloaded affected members, compensation, retention, and resnapshot
guidance. The projection client does not mirror history in residency or invent a
second timeline. Applications without MOS-16 can omit the adapter and plan a
model-specific undo or redo operation through the original edit seam.

## Ordinary transaction bridge

An application can bind independently authored transactions to a batch client.
Each value model opts in with a deterministic transaction encoder that receives
the exact old and new values. A transceiver model instead receives the signal
that changed it. The existing operation schema remains the normalization and
validation boundary for both forms.

<Exhibit src="realtime/bridge-a-domain-transaction.ts" />

The Store publishes an immutable, monotonically sequenced commit event only
after a successful outermost transaction has settled. Nested outcomes retain
their order inside that event, while an aborted outer transaction publishes
nothing. Cyclic structural values are cloned and frozen safely. Values such as
functions, `Map`, `Set`, and other containers whose internal slots cannot be
made immutable are represented by an explicit sentinel and listed in
`isolationFailures`; they are never silently replaced with `undefined`. The
bridge listens only for the application transaction tokens named in its
configuration, so its own settlement and reprojection transactions cannot
recursively produce proposals.

Encoding and asynchronous Standard Schema validation run after the commit stack
and in commit order. All owned member changes from one transaction become one
batch, including several operations for the same member. A transaction that
does not change a durable member produces no batch. The commit event also
retains isolated pre/post member snapshots as a Store-owned capability. The
client uses that capability to adopt the already-visible optimistic result
without running reducers twice, while retaining the exact pre-state needed for
atomic rejection and reprojection. A failed preparation remains available on
the bridge and blocks later commits until the application retries it. The
bridge never truncates retained commits: silently dropping one would break
convergence. Applications should monitor `problem` and `pendingCommitCount`,
repair and retry failures promptly, and dispose the bridge when abandoning a
collaborative session. Disposal stops new capture and releases commits that
have not begun preparation; preparation already in flight may finish.
