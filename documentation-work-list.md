# Documentation Work List

This list tracks documentation needed for the current public API surface of atom.io.
Docs should act as the source of truth for how things work now; release history and
migration details belong in changesets and changelogs.

## Foundations

- [ ] Expand `/docs/foundations` from an overview into the hub for public support modules.
- [ ] State that foundations are public support APIs, not atom.io state features.
- [ ] Show that each foundation is imported from its own submodule.
- [ ] Document `atom.io/foundations/future`.
  - [ ] `Future`
  - [ ] construction from a promise or executor
  - [ ] `use`
  - [ ] `done`
- [ ] Document `atom.io/foundations/subject`.
  - [ ] `Subject`
  - [ ] `subscribe`
  - [ ] unsubscribe callbacks
  - [ ] `next`
  - [ ] `StatefulSubject`
  - [ ] `state`
- [ ] Document `atom.io/foundations/json`.
  - [ ] `primitive`
  - [ ] `Json.Serializable`
  - [ ] `Json.Object`
  - [ ] `Json.Array`
  - [ ] `Json.Tree`
  - [ ] `stringified`
  - [ ] `parseJson`
  - [ ] `stringifyJson`
  - [ ] `JsonIO`
  - [ ] `JsonInterface`
  - [ ] `isJson`
  - [ ] `JSON_TYPE_NAMES`
  - [ ] `JsonTypeName`
  - [ ] `JsonTypes`
  - [ ] `JSON_DEFAULTS`
- [ ] Document `atom.io/foundations/canonical`.
  - [ ] `Canonical`
  - [ ] `packed`
  - [ ] `packCanonical`
  - [ ] `unpackCanonical`
  - [ ] recommended tuple-key usage for compound identity
- [ ] Document `atom.io/foundations/entries`.
  - [ ] `Entries`
  - [ ] `KeyOfEntries`
  - [ ] `ValueOfEntry`
  - [ ] `FromEntries`
  - [ ] `fromEntries`
  - [ ] `ToEntries`
  - [ ] `toEntries`
- [ ] Document `atom.io/foundations/enumeration`.
  - [ ] `IndexOf`
  - [ ] `Flip`
  - [ ] `TwoWay`
  - [ ] `Enumeration`
  - [ ] `enumeration`
- [ ] Document `atom.io/foundations/type-utils`.
  - [ ] `Flat`
  - [ ] `ViewOf`
- [ ] Document `atom.io/foundations/overlays`.
  - [ ] Explain source-backed staged collections.
  - [ ] Explain that source items iterate first, followed by overlay-only items.
  - [ ] Explain `clear` and source-member reinsert behavior.
  - [ ] `MapOverlay`
    - [ ] constructor accepts a source `Map`.
    - [ ] `hasOwn`
    - [ ] `deleted`
    - [ ] `changed`
    - [ ] behavior when source keys are changed, deleted, cleared, and reinserted
  - [ ] `SetOverlay`
    - [ ] constructor accepts a source `Set`.
    - [ ] `hasOwn`
    - [ ] `iterateOwn`
    - [ ] `source`
    - [ ] `deleted`
    - [ ] behavior when source values are added, deleted, cleared, and reinserted
  - [ ] `RelationsOverlay`
    - [ ] constructor
    - [ ] `get`
    - [ ] `set`
    - [ ] `has`
    - [ ] `delete`
    - [ ] lazy `SetOverlay` creation for source relations
- [ ] Document `atom.io/foundations/junction`.
  - [ ] Relation schema with `between` and `cardinality`.
  - [ ] Cardinalities: `1:1`, `1:n`, and `n:n`.
  - [ ] Constructor data shape.
  - [ ] Optional advanced configuration.
  - [ ] `set`
  - [ ] object-style `set`
  - [ ] `delete`
  - [ ] object-style `delete`
  - [ ] `has`
  - [ ] `getRelatedKey`
  - [ ] `getRelatedKeys`
  - [ ] relation content
  - [ ] `getContent`
  - [ ] `replaceRelations`
  - [ ] `getRelationEntries`
  - [ ] `toJSON`
  - [ ] `overlay`
  - [ ] `incorporate`

## Core API

- [x] Document `getJsonToken`.
  - [x] mutable atom token overload
  - [x] mutable atom family token plus key overload
  - [x] returned writable selector token for the mutable state's JSON form
- [x] Document `inspectTimeline`.
  - [x] `TimelineInspection`
  - [x] `{ at, length }`
  - [x] usage alongside `timeline`, `undo`, `redo`, and `clearTimeline`
- [x] Ensure public token docs describe token `type` fields as part of the public token shapes.

## Testing

- [ ] Expand `/docs/testing` with public helpers from `atom.io/testing`.
- [ ] Document `stateExists`.
  - [ ] token overload
  - [ ] family plus key overload
  - [ ] non-creating existence checks
- [ ] Document `stateExistsInStore`.
  - [ ] explicit store argument
  - [ ] token overload
  - [ ] family plus key overload
- [ ] Document `storeHasStateValues`.
  - [ ] default implicit store behavior
  - [ ] explicit store behavior
- [ ] Document `hasImplicitStoreBeenCreated`.
- [ ] Document `setTestLogLevel`.
  - [ ] `null` as the committed-test value
  - [ ] returned logger for spies and assertions
- [ ] Document `takeSnapshot`.
  - [ ] snapshot `store`
  - [ ] `restore`
  - [ ] implicit store restoration in place

## Transceivers

- [ ] Update transceiver docs to identify `OList` and `UList` as the supported mutable collection transceivers.
- [ ] Mark `SetRTX` as deprecated in generated/API-facing documentation.
- [ ] Keep byte-level wire encoding details out of public docs unless they become intentional public contract.

## Site Cleanup

- [ ] Confirm navigation points users to `/docs/foundations`.
- [ ] Review `docs/source/exhibits/json` and either rename, re-home, or remove examples that no longer match a current docs section.
- [ ] Add small examples for each foundation section that benefits from one.
- [ ] Regenerate agent docs after documentation changes.
- [ ] Run docs/site validation after updates.
