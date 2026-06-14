# Documentation Work List

This list tracks documentation needed for the current public API surface of atom.io.
Docs should act as the source of truth for how things work now; release history and
migration details belong in changesets and changelogs.

## Foundations

- [x] Expand `/docs/foundations` from an overview into the hub for public support modules.
- [x] State that foundations are public support APIs, not atom.io state features.
- [x] Show that each foundation is imported from its own submodule.
- [x] Document `atom.io/foundations/future`.
  - [x] `Future`
  - [x] construction from a promise or executor
  - [x] `use`
  - [x] `done`
- [x] Document `atom.io/foundations/subject`.
  - [x] `Subject`
  - [x] `subscribe`
  - [x] unsubscribe callbacks
  - [x] `next`
  - [x] `StatefulSubject`
  - [x] `state`
- [x] Document `atom.io/foundations/json`.
  - [x] `primitive`
  - [x] `Json.Serializable`
  - [x] `Json.Object`
  - [x] `Json.Array`
  - [x] `Json.Tree`
  - [x] `stringified`
  - [x] `parseJson`
  - [x] `stringifyJson`
  - [x] `JsonIO`
  - [x] `JsonInterface`
  - [x] `isJson`
  - [x] `JSON_TYPE_NAMES`
  - [x] `JsonTypeName`
  - [x] `JsonTypes`
  - [x] `JSON_DEFAULTS`
- [x] Document `atom.io/foundations/canonical`.
  - [x] `Canonical`
  - [x] `packed`
  - [x] `packCanonical`
  - [x] `unpackCanonical`
  - [x] recommended tuple-key usage for compound identity
- [x] Document `atom.io/foundations/entries`.
  - [x] `Entries`
  - [x] `KeyOfEntries`
  - [x] `ValueOfEntry`
  - [x] `FromEntries`
  - [x] `fromEntries`
  - [x] `ToEntries`
  - [x] `toEntries`
- [x] Document `atom.io/foundations/enumeration`.
  - [x] `IndexOf`
  - [x] `Flip`
  - [x] `TwoWay`
  - [x] `Enumeration`
  - [x] `enumeration`
- [x] Document `atom.io/foundations/type-utils`.
  - [x] `Flat`
  - [x] `ViewOf`
- [x] Document `atom.io/foundations/overlays`.
  - [x] Explain source-backed staged collections.
  - [x] Explain that source items iterate first, followed by overlay-only items.
  - [x] Explain `clear` and source-member reinsert behavior.
  - [x] `MapOverlay`
    - [x] constructor accepts a source `Map`.
    - [x] `hasOwn`
    - [x] `deleted`
    - [x] `changed`
    - [x] behavior when source keys are changed, deleted, cleared, and reinserted
  - [x] `SetOverlay`
    - [x] constructor accepts a source `Set`.
    - [x] `hasOwn`
    - [x] `iterateOwn`
    - [x] `source`
    - [x] `deleted`
    - [x] behavior when source values are added, deleted, cleared, and reinserted
  - [x] `RelationsOverlay`
    - [x] constructor
    - [x] `get`
    - [x] `set`
    - [x] `has`
    - [x] `delete`
    - [x] lazy `SetOverlay` creation for source relations
- [x] Document `atom.io/foundations/junction`.
  - [x] Relation schema with `between` and `cardinality`.
  - [x] Cardinalities: `1:1`, `1:n`, and `n:n`.
  - [x] Constructor data shape.
  - [x] Optional advanced configuration.
  - [x] `set`
  - [x] object-style `set`
  - [x] `delete`
  - [x] object-style `delete`
  - [x] `has`
  - [x] `getRelatedKey`
  - [x] `getRelatedKeys`
  - [x] relation content
  - [x] `getContent`
  - [x] `replaceRelations`
  - [x] `getRelationEntries`
  - [x] `toJSON`
  - [x] `overlay`
  - [x] `incorporate`

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

- [x] Expand `/docs/testing` with public helpers from `atom.io/testing`.
- [x] Document `stateExists`.
  - [x] token overload
  - [x] family plus key overload
  - [x] non-creating existence checks
- [x] Document `stateExistsInStore`.
  - [x] explicit store argument
  - [x] token overload
  - [x] family plus key overload
- [x] Document `storeHasStateValues`.
  - [x] default implicit store behavior
  - [x] explicit store behavior
- [x] Document `hasImplicitStoreBeenCreated`.
- [x] Document `setTestLogLevel`.
  - [x] `null` as the committed-test value
  - [x] returned logger for spies and assertions
- [x] Document `takeSnapshot`.
  - [x] snapshot `store`
  - [x] `restore`
  - [x] implicit store restoration in place

## Site Cleanup

- [x] Confirm navigation points users to `/docs/foundations`.
- [ ] Review `docs/source/exhibits/json` and either rename, re-home, or remove examples that no longer match a current docs section.
- [x] Add small examples for each foundation section that benefits from one.
- [x] Regenerate agent docs after documentation changes.
- [x] Run docs/site validation after updates.
