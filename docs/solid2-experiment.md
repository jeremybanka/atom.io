# Solid 2 release candidate experiment

Initially tested with `solid-js@2.0.0-rc.17` on October 23, 2026. Current compatibility targets exactly `solid-js@2.0.0-rc.20`, alongside Solid 1.9. The rc.20 upgrade drops rc.17–19 support and ships as a patch because these are prerelease peers. Both supported Solid versions are tested with released `atom.io@0.53.3` and the coordinated SDK candidate. All RC environments enforce a 1,440-minute minimum release age with strict rejection and no age exceptions.

The `*-solid2` environments test rc.20 and remain the rolling candidates for Renovate proposals after the normal one-day delay. Those proposals do not automatically rewrite the adapter's peer declaration or automerge. Supporting another RC requires updating the exact version in the peer declaration, testing both SDK environments, and including a changeset; superseded RCs do not need retained compatibility environments. Breakage checks the declared support against the published baseline and requires representative coverage before the upgrade can pass. The npm release policy explicitly permits the rc.17–19 support removal in the `@atom.io/solid` 0.1.3 → 0.1.4 patch; other releases retain the normal semantic-version policy.

## What breaks without changes

The original packed adapter fails at runtime and in consumer declaration checking:

- Solid 2 contexts are callable providers; `StoreContext.Provider` is absent. `StoreProvider` now selects the correct provider shape and forwards children lazily so hooks execute inside the supplied store's context.
- Solid 2 requires separate compute and apply callbacks for `createEffect`. The old single-callback subscription setup throws `MISSING_EFFECT_FN` in development. The adapter uses `onSettled` and its returned cleanup in Solid 2, retaining the Solid 1 effect lifecycle.
- Solid 2 no longer exports `JSX` from `solid-js`. The provider now describes its return type through the common `FlowComponent` type, without requiring a DOM renderer dependency.
- Solid 2 interprets function initializers as derived signals. The bridge now stores only an invalidation signal, with equality disabled, instead of putting arbitrary atom snapshots into a Solid signal. Its narrowly scoped `ownedWrite` option permits external notifications originating in owned scopes. Snapshot hydration remains untracked and immediate.

The expanded [consumer contracts](../packages/solid/__tests__/fixtures/consumer/runtime.ts) cover store isolation, writes before subscriptions settle, subsequent reactive notifications, actual unsubscribe, mutable and function snapshots, JSON, timelines, and loadable promises. Both production and development browser conditions run in the peer matrix, followed by server reads and declaration checking with library checking enabled. The ordinary Solid test and coverage commands prepare and reuse the same isolated RC environment, so the compatibility branches are covered without replacing the workspace Solid 1 dependency. Provider children are consumed by a render effect: merely reading a lazy Solid 2 provider outside an observer does not activate its descendant effects.

The released SDK's optional Solid peer still describes its former bundled Solid 1 adapter. The released-SDK experiment contains a package-scoped pnpm allowance for exactly Solid 2 rc.20 on `atom.io@0.53.3>solid-js`; it tests the new standalone adapter against the old SDK core. This does **not** establish that the old SDK's bundled `atom.io/solid` entry supports Solid 2. The coordinated SDK environment needs no such allowance.

## External state opportunities

The executable [Solid 2 experiments](../packages/solid/__tests__/fixtures/consumer/solid2.ts) are consumer fixtures, not new public APIs. The peer suite typechecks these fixtures against Solid 2 in both RC environments before running them in browser production and development modes. Solid 1 environments typecheck and run the shared contracts separately.

**Native async computation.** The async experiment passes the accessor returned by `useO` into a memo. The dependent effect waits on the atom.io promise and then receives its resolved value. This could support a separate accessor that participates in Solid's `Loading`, `Errored`, and pending UI, while preserving the existing `useLoadable` contract for explicit loading/error values. Boundary rendering, retries, caught atom.io errors, superseded promises, streaming hydration, and optimistic transactions still require their own tests before such an API is published.

**Subscription streams through `from`.** An rc.18 spike streamed snapshots and then invalidation revisions through `from`. Snapshot streaming broke immediate reads. Revision streaming preserved reads but needed explicit coalescing to avoid duplicate final-value deliveries, and `flush()` alone could not drain its asynchronous notifications. Preserving synchronous server reads also required client-only memo configuration. The comparison did not establish a reliable performance benefit, so the adapter retains its existing signal and subscription lifecycle. A separate async-aware API remains a possible future experiment.

**External dependency tracking.** `enableExternalSource` can wrap Solid computations in another library's tracking scope. The proof of concept records explicit tracked atom reads, subscribes to the atoms actually used, replaces dependencies when branches change, mirrors `untrack`, and cleans up on disposal. A production atom.io integration would need a scoped read-tracking facility, including store identity and nested scopes; this experiment does not instrument ordinary `getState` calls. Registration affects all subsequent Solid computations, so it should be explicit and installed once, not called per hook. This hook already exists in Solid 1; Solid 2 changes its registration signature to a configuration object. Its existence is not a new Solid 2 capability.

## Scheduling limits and recommendation

React 18's analogous API is `useSyncExternalStore`. Solid 2's external-source hooks offer useful integration mechanisms, but these tests do not establish equivalent concurrent snapshot guarantees.

The compatibility adapter intentionally preserves immediate atom.io reads: its accessor tracks a Solid invalidation signal and then reads the current external store. Solid 2 computations and effects still follow Solid's scheduling. A direct accessor can therefore see a new external value before an already-computed Solid memo updates. Mutable values and async-held views need particular care because the external store is not versioned by Solid's transaction system. Forcing `flush` inside every notification would interfere with batching and does not solve snapshot isolation.

Keep the compatibility path small and preserve `useO` / `useLoadable` behavior. Explore a separate Solid-native async accessor built on a memo, with deliberate snapshot and error semantics. Consider global external read tracking only if removing per-atom accessors justifies a new core tracking facility. No global bridge is installed by importing `@atom.io/solid`.

## Upstream references

- [Solid 2 migration guide](https://github.com/solidjs/solid/blob/solid-js%402.0.0-rc.17/documentation/solid-2.0/MIGRATION.md): context, effect, JSX, batching, and async changes.
- [Published Solid RC package metadata](https://www.npmjs.com/package/solid-js/v/2.0.0-rc.20): exact tested version.
- [Solid 2 subscription conversion](https://github.com/solidjs/solid/blob/solid-js%402.0.0-rc.18/packages/solid/src/from.ts): rc.18 live-source branding and hydration intent; absent in rc.17.
- [Solid signals external bridge](https://github.com/solidjs/solid/blob/solid-js%402.0.0-rc.17/packages/signals/src/core/external.ts): computation wrapping and registration.
