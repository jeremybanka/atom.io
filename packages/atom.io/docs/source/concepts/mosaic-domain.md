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

## Atomic batches

A durable member may register a deterministic batch model. Value models pair a
Standard Schema operation boundary with a pure reducer. Existing Mosaic
transceiver models can instead register their constructor and operation schema;
preflight clones their serializable checkpoint before asking the model to
validate and reduce an operation.

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
recovery.

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

The atomic-batch layer deliberately does not implement partial residency,
incremental checkpoint graphs, or actor-selective retained history. Those
facilities build on the batch revision and gesture boundaries in MOS-12,
MOS-13, and MOS-16 respectively. This release's recovery adapter retains the
accepted tail; a production adapter may compact only after those later
checkpoint and retention contracts define a safe cut.

The current client submission boundary owns the ordinary transaction that
settles its one-or-many member operations. Automatically translating writes
from an independently authored atom.io transaction remains an integration
boundary: doing so correctly requires a generic committed-transaction lifecycle
hook and model-owned change encoding. Inferring completion from timing or
mirroring the transaction in a Mosaic-only registry would make rollback and
asynchronous schema validation unsound, so this draft leaves that bridge
explicit rather than weakening the commit guarantee.
