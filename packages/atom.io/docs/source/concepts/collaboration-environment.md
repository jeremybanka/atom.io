---
slug: collaboration-environment
title: Collaboration environment
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

A collaboration environment describes which parts of an atom.io state graph
participate in one collaboration protocol. It does not create another state
graph or wrap its members in special resources. Its members are ordinary atoms,
atom families, and selectors, so core APIs and the existing React and Solid hooks
continue to read and write them directly.

<Exhibit src="realtime/declare-a-collaboration-environment.ts" />

The environment definition is Store-independent. Activating it validates its
configuration with Standard Schema, checks that every member belongs to the
target Store, reserves its durable membership, and returns a disposable scope.
This makes the same definition usable in the implicit Store, an application
Silo, or an isolated headless test Silo.

## Ownership

Atoms still own values, effects, subscriptions, and family-member disposal.
Selectors still own derivation. A collaboration environment owns only the
coordination metadata needed by a collaboration transport: identity, protocol
version, validated configuration, named membership, addresses, and durable
membership claims.

Each durable atom address can belong to at most one active collaboration
environment in a Store. A durable family declaration is intensional: it claims
the family pattern rather than enumerating its current members. Members created
later are therefore covered, and another environment cannot claim either the
same family or one of its individual members. Claims are local to a Store and
are released when the scope is disposed. Clearing the Store also disposes all of
its active collaboration scopes.

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
          Replicated application state. The environment reserves exclusive
          durable ownership and exposes a Standard Schema for untrusted values.
        </td>
      </tr>
      <tr>
        <td><code>local</code></td>
        <td>
          Store-local application state, such as a local selection or draft.
          It participates in the model without being accepted from a remote peer.
        </td>
      </tr>
      <tr>
        <td><code>derived</code></td>
        <td>
          Selectors derived from collaborative and local members. Derivation
          remains entirely inside the ordinary atomic state graph.
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
schema are validation boundaries. The environment does not validate ordinary
local writes. A realtime implementation validates untrusted input before it
resolves a family address or applies a remote value.

For a regular atom, the value schema produces the atom's value type. For a
mutable atom, it produces the serializable snapshot returned by the
transceiver's `toJSON` method. Mosaic operation validation remains the Mosaic
model's responsibility; an environment does not replace that operation protocol
with snapshot writes. Batching and synchronization layers can therefore choose
the appropriate payload policy without weakening this environment's state and
address schemas.

## Member addresses

An active scope creates serializable member addresses from the environment
identity, version, logical member name, and, for a family, its canonical key.
Resolving an untrusted address verifies the environment and member name, then
validates a family key before atom.io can mint the family member. Singleton
addresses reject keys.

The address contract is intentionally transport-neutral. It establishes the
Store and schema boundary that batching, ordering, reconciliation, persistence,
and presence layers can build on without moving application state out of
atom.io.

## Granularity

A one-atom environment is first-class and useful for comments, snippets, and
other small collaborative values. MosaicText remains a good mutable-atom value
for bounded collaborative text with per-participant history.

Large documents should use an environment whose atom families partition the
model into bounded members. Because family membership is intensional, activating
the environment does not enumerate or materialize the whole document. This
contract establishes that scalable shape; synchronization and reconciliation
layers decide when particular members are loaded and exchanged.
