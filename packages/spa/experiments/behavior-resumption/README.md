# SPA behavior-resumption spike

## Result

**A narrowly restricted, opt-in behavior-resumption path works on the checkout’s server renderer and atom.io engine.** A click loads one addressable handler, restores only its captured numeric atoms and direct text bindings, and updates the existing DOM without importing or running the component, SPA's hydrator, or the full island.

This is a **manual proof of the boundary**, not an automatic compiler feature or a general-purpose alternative to Qwik. It lives in a repository-only experiment with no package exports and does not change the normal SPA hydrator or the independent resumability package.

The code is rebased onto main [`1d6a0a262d13ffa9625ef934ea7949bf470530e7`](https://github.com/jeremybanka/atom.io/commit/1d6a0a262d13ffa9625ef934ea7949bf470530e7), including merged [Atom.io PR #1465](https://github.com/jeremybanka/atom.io/pull/1465) and subsequent updates. The original measurements predate that merge and are pinned to [`d0a655a9ec05982ffe7af26f9920a2d9dbf07182`](https://github.com/jeremybanka/atom.io/tree/d0a655a9ec05982ffe7af26f9920a2d9dbf07182). The archived measurements bundle that exact PR compiler, SSR and atom.io state-engine source with production flags. The repository harness now bundles the current checkout; it does not silently fetch another source revision. Qwik 1.20.3 is a broader reference control, not an equal-capability competitor to this specialized path.

## What is actually implemented

The fixture is the same storefront as the preceding benchmark: product cards each have an Add to bag button, a per-product quantity, and one shared cart total. The spike's initial rendering has the same visible text and pixel-identical screenshots as eager SPA for 12 cards.

### 1. Server runs ordinary component setup and renders with SPA

`spike/server.tsx` uses the checkout’s JSX compiler, `renderToString`, `useGetter`, and actual atom.io atoms. Server-only component setup computes titles and reads state. Explicit annotations are authored alongside that markup; they are **not extracted by the compiler**.

The emitted button carries an addressable handler export and a JSON array of captured cell IDs. Each cell has a separate inert JSON record containing its finite numeric value and direct text-target IDs. See the executable [server fixture](./spike/server.tsx) for the markup.

The original SPA SSR comment markers remain in the actual output. All state records still arrive and are parsed as HTML upfront. State is stored in separate records so first interaction does not JSON-decode a 1,001-cell global snapshot.

### 2. One small loader captures clicks

`host/loader.ts` is inlined as a classic script in the document head. In the archived build it was **699 minified bytes, 473 gzip bytes in isolation**; whole-page compressed sizes below already include it. It installs one delegated click listener, finds the annotated non-submit button, and imports the module named by the address. Module promises are shared, and a promise queue retains click order while loading. No state records or component tree are scanned at startup.

The address is restricted to an app-owned `/resume/<name>.js#<export>` route. The handler receives the button, not an arbitrary serialized event object. Keyboard Enter/Space works because native buttons dispatch click.

### 3. Only captured cells and text subscriptions are restored

`spike/cart.ts` exports `addToBag`. Its bundle composes `host/scope.ts` with `spike/atom-state.ts` through `spike/runtime.ts`, and includes the **actual atom.io state engine**, not a substitute counter implementation.

On the first click, `capture(button)` reads `q0` and `cart`, parses only those two JSON records, resolves the named existing text nodes, creates one shared store and two atom.io atoms with the **serialized values**, and installs two atom.io subscriptions. The handler increments both atoms. Subscriptions update `Text.data`, keeping the DOM elements, text nodes and SSR comments intact.

On a later click of another card, only that card's atom/binding is added; the shared cart already exists. Clicking product 999 on a 1,000-card page still starts with only **two atoms and two bindings**, not 1,001. There is no client component setup, full tree traversal, or SPA hydration call. There **is** small, lazy runtime work to materialize the captured cells and their subscriptions; this does not eliminate all first-use setup. It recreates the declared small graph, not the original JavaScript closure or subscription objects.

### 4. Cold versus preloaded behavior

- **Cold:** only the inline loader executes/downloads initially. The handler plus atom engine is fetched on the first click.
- **Preloaded:** a head `modulepreload` downloads and may parse/compile the handler bundle early. It does not evaluate that module, create the store, or run component setup until click. This shifts download cost earlier to reduce first-interaction delay.

In the archived build the handler/runtime/atom bundle was **35,625 minified bytes / 10,512 gzip bytes**. Eager SPA's equivalent fixture bundle was **44,595 / 14,120 bytes**. These are historical sizes, not sizes of the refactored checkout. Thus this experiment does not make atom.io disappear: almost all the deferred bytes are the real state engine and its imported machinery.

## Archived same-batch comparison: 200 cards

These are the original spike measurements preserved in [evidence/](./evidence/), not timings remeasured after integration. Five fresh-browser samples per variant, in alternating variant order. Medians, milliseconds; compressed sizes are response bodies, not full wire traffic. Frame proxy is two animation frames after the observed cart mutation, **not measured pixels or INP**.

| Variant                      | Startup script | Main-thread tasks | Initial bodies, kB | First DOM update | First frame proxy | Browser component setups |
| ---------------------------- | -------------: | ----------------: | -----------------: | ---------------: | ----------------: | -----------------------: |
| SPA eager                    |          252.5 |             448.4 |               17.5 |              6.5 |              21.8 |                      201 |
| SPA eager + preload          |          241.3 |             440.5 |               17.6 |              6.8 |              18.4 |                      201 |
| SPA per-card visible islands |           65.2 |             279.6 |               18.9 |              5.2 |              18.2 |                       13 |
| Qwik default                 |           14.6 |             244.9 |               35.5 |             50.4 |             138.3 |                        0 |
| Spike cold                   |            2.4 |             226.8 |                6.4 |            237.0 |             334.3 |                        0 |
| Spike preloaded              |            0.6 |             226.7 |               17.0 |             25.1 |              36.3 |                        0 |

The cold spike avoids handler/state-engine startup execution and download, but pays roughly a quarter-second to update the DOM and one-third second to the frame proxy on the first click in this synthetic slow-network profile. Preloading substantially reduces that delay, without rerunning component setup. Eager SPA is still fastest on the first click once it has hydrated. Warm frame proxies were about 22–23 ms for eager SPA and both spike forms, versus 40 ms Qwik in this particular graph.

The 200-card startup-script ranges were 229–263 ms for eager SPA, 59–69 ms for visible islands, 11.4–17.0 ms for Qwik, 1.11–5.24 ms cold spike, and 0.18–1.56 ms preloaded spike. Tiny loader timings are particularly noisy. Preloading does not intrinsically reduce SPA's component setup count; the eager/preload difference in script medians is run variation and scheduling, not avoided setup.

The spike's additional state/handler/binding HTML is a cost. For 200 cards, compressed HTML grows from **3,390 bytes** (eager SPA) to **6,438 bytes** (cold spike, including loader). Adding the handler preload produces a 16,981-byte initial body total, only slightly smaller than eager SPA. A small JavaScript entry alone is not the total download budget.

## Scaling, early input, and server cost

The 12- and 1,000-card sensitivity checks use three fresh-browser repetitions each, so treat them as exploratory, not precise estimates.

| Cards | Variant         | Startup script | Initial bodies, kB | First DOM update | First frame proxy |
| ----: | --------------- | -------------: | -----------------: | ---------------: | ----------------: |
|    12 | SPA eager       |          57.92 |               15.0 |              6.3 |              13.0 |
|    12 | Spike cold      |           0.03 |                1.5 |            237.3 |             246.2 |
|    12 | Spike preloaded |           0.03 |               12.1 |             20.8 |              32.0 |
|  1000 | SPA eager       |         759.21 |               27.1 |              7.0 |              40.4 |
|  1000 | Spike cold      |           1.11 |               26.1 |            239.1 |             274.8 |
|  1000 | Spike preloaded |           0.80 |               36.6 |             23.8 |             161.6 |

At 1,000 cards, eager SPA executes 1,001 component setups; the spike still executes zero and restores only two cells for the first click. Yet the preloaded spike's **36.6 kB exceeds eager SPA's 27.1 kB** because of per-cell HTML metadata. Its first DOM update remains about 24 ms, while its frame proxy reaches 162 ms. Browser rendering/scheduling costs do not disappear when component setup is avoided; this test does not separately attribute that gap. Total startup main-thread tasks are about 796 ms preloaded spike versus 1,532 ms eager SPA, a smaller ratio than script execution alone suggests.

A separate test sends a real CDP click about 550 ms after navigation starts. Recorded click timestamps are 549–553 ms, all on product zero. All five samples per variant update correctly: median input timestamp to frame proxy is **162 ms SPA with head preload, 258 ms cold spike, and 104 ms preloaded spike**. SPA also handles these early clicks when preloaded; the spike's benefit is avoiding component setup, not a unique ability to receive early input. This fixed-time test includes queued input, unlike the settled capture-listener timing.

Separate warm Node SSR runs (15 repetitions after two warmups) measure eager SPA versus the spike: **0.54/0.57 ms** for 12 cards, **4.18/4.79 ms** for 200, and **17.16/20.66 ms** for 1,000. Metadata serialization and additional server markup are not free. These are local renderer timings, not request throughput or deployment timings, and are not included in the static-file browser tests.

## Checks and boundaries

`schema.test.mjs` tests supported snapshot/capture decoding and rejection of invalid shapes. `validate.mjs` verifies:

- Pixel and visible-text equivalence with the checkout fixture.
- No handler resource download or component execution before cold interaction.
- No handler module evaluation before interaction in the preloaded case.
- Nonzero server values (quantity 7, cart 11) restore correctly, so success is not explained by recreating zero defaults.
- A shared cart updates from different cards; only the touched state is materialized.
- Existing DOM element identity is retained.
- Forty rapid clicks across two buttons survive a deliberately delayed import and request the module only once.
- Removing a button while loading prevents that pending action from mutating state.
- Missing snapshots surface an error without mutation and do not stop another valid card.
- Enter/Space activate the same lazy handler.
- A failed module load surfaces an error and does not mutate. Chromium caches that failed import in the document, so a later click alone does not recover; reload does. This is an explicit prototype limitation, not hidden by a passing happy-path test.
- Build graph contains the actual atom.io engine but no SPA hydration/core or server component module.
- A separate host build contains only host modules, with no renderer or state-engine dependency. Unit tests exercise the same host through a non-atom in-memory adapter, with independent cells, scope/document isolation, exact node identity and cleanup. This is a test double, not a second production consumer.

In the archived run, all **48 settled-performance samples** have correct final cart/quantities and no page errors. All **15 early-input samples** updated the cart with no page errors. The two schema tests and all 11 browser/build validation checks pass.

The focused TypeScript check uses the checkout's compiler options plus DOM libraries and passes. Unused-parameter reporting is disabled because source-bundling includes an existing unused generic. This is not a complete monorepo lint/test or Astro integration run.

### Deliberately unsupported

- Automatic closure extraction or capture analysis, arbitrary JS object graphs, functions, class instances, promises, cycles, computed selectors, effects, mutable atoms, timelines, or external atom-store interoperability.
- Structural/conditional rendering, list reconciliation, changing attributes, SVG, graphics, refs, mount callbacks or component cleanup. Only dedicated finite-number text containers with stable document-wide IDs are accepted.
- General event replay semantics, forms, navigation, default-action cancellation, event modifiers or event-object capture. Only ordinary `type="button"` click behavior is tested.
- Independent event scheduling: the simple global queue could let a future slow/asynchronous handler delay unrelated buttons. The tested handler is synchronous.
- Multiple independently versioned roots, SPA/Astro client navigation, hydration/resumption ownership transitions, streaming coordination, snapshot updates for reserialization, or individual disposal of removed bindings. State and bindings live for this document; detached text writes are skipped. The internal host has explicit scope cleanup and the fixture disposes on non-persisted pagehide while retaining BFCache state. This does not solve Astro navigation or per-island lifetimes.
- Production error UI, deployment/version manifests, content-hashed module addresses, and CSP nonce/hash integration for the inline loader. The loader raises a `resume-error` DOM event; it is not production recovery UX. Handler attributes and the `/resume/` route are trusted app-owned markup; untrusted HTML must not author them.

The spike does **not** use the PR's resumability data-producer adapter to avoid component setup; that adapter currently restores producer outputs while normal SPA hydration still runs. This experiment adds an independent, explicit wire contract around the same SSR/state engine. It is an experiment toward an opt-in mode, not a modification to existing adapter behavior.

## Strategic goal and next major milestone

The useful result is that **addressable handler + captured state IDs + serialized text binding addresses** can avoid replaying component setup without discarding atom.io. Existing data resumption supplies server-produced defaults, but SPA still runs component setup to reconstruct behavior. This experiment asks what must cross the server/browser boundary to avoid that second step for a narrow interaction.

The next major milestone is **compiler-assisted behavior resumption for a deliberately restricted SPA pattern**:

1. Start with ordinary SPA source: an event handler using captured regular-atom setters and direct text reads of those atoms.
2. Extract an addressable handler module, explicit capture IDs, numeric state records and text binding addresses automatically. No manually authored data attributes or parallel client component implementation should be needed for an eligible example.
3. At first interaction, import only the behavior and state adapter, restore only the referenced graph and update the existing text nodes. Assert zero browser component setup and no SPA hydrator in the handler dependency graph.
4. Reject or explicitly fall back to ordinary SPA hydration when analysis cannot establish this contract. Never silently resume only part of an unsupported component or let both paths own the same DOM.
5. Demonstrate nonzero server state, a shared cart, early/repeated input and a heterogeneous intended page against eager SPA, visible islands and Qwik with the same harness. Keep cold and preloaded results separate.

That milestone would establish automatic behavior resumption. Production adoption also requires ownership/disposal, navigation, streaming coordination, versioned module manifests, CSP integration and error recovery. Those are not supplied by this draft, and this document does not promise a delivery date or a general-purpose closure serializer.

## Responsibility boundaries after reading #1465

#1465's final shape is the guide here: **resumability owns producer data, scopes and the generic Astro host; SPA owns rendering, state-engine integration and its island-specific behavior.** It is more than an isolated codec plugin: request capture, streaming sidecars, browser harvesting and the generic `resumableRenderer` wrapper are already on the independent side of that boundary.

This revision applies that distinction within the experiment:

- `host/loader.ts`, `schema.ts`, `dom.ts` and `scope.ts` contain the click loader, numeric wire validation, DOM record/target decoding, direct-text binding, scoped cleanup and injected `StateAdapter` contract. A standalone build verifies that both scope and loader depend only on host files, not atom.io, SPA, Astro or the published resumability package.
- `spike/atom-state.ts` owns the real atom.io Store, atom creation, reads, writes and subscriptions. It has no DOM access. `spike/runtime.ts` is the static fixture's composition root and page lifetime owner.
- `spike/server.tsx` remains a SPA-specific producer. Compiler eligibility, handler extraction, placement of binding addresses and safe fallback necessarily belong in SPA's compiler/adapter, not in the generic host.
- The behavior wire is separate from producer-data payloads. It does not consume or mutate Astro's existing sidecars, install a competing generic Astro host, or make resumability import SPA/atom.io.
- Tests exercise the host with a genuinely non-atom in-memory adapter, independent cells/shared captures, separate documents/scopes, exact node identity, disposal, failure-tolerant cleanup and late-notification suppression. Fixture runtime tests cover BFCache retention versus permanent pagehide disposal.

**One production ownership correction:** #1465 removed the shared `browserApplication` override of `store.runDefault`, but left a capture/reset in disposal. That could overwrite a method subsequently installed by another owner. This draft removes those two obsolete lines and regression-tests preservation of the later method. The private-store override in `astro-resumability-client.ts` is an actual owned binding and remains unchanged, including its cleanup.

**Reusable seam, not yet general-purpose machinery.** The loader/host contract no longer needs atom.io or SPA, but this is still a finite-number/direct-text prototype. A test adapter is not a second real consumer. The actual producer and state adapter remain deliberately SPA/atom.io-specific. Prove compiler-generated metadata and another real integration before extracting or publishing a standalone behavior core.

Future Astro behavior integration should extend generic host harvesting/lifetime facilities while leaving SPA readiness and private-store semantics in the SPA adapter. This static experiment does not implement that integration.

## Repository integration and verification

The committed evidence is historical. This integration makes the fixture reproducible from a checkout and adds focused regression tests without publishing new SPA entrypoints. It also rejects non-finite client writes/server initial values and actually asserts preservation of existing text/comment nodes. Those guards do not establish arbitrary-state support.

### Fresh validation on the rebased tree

Local checks used Node 26.13.0. The archived performance evidence was not rewritten.

- Experiment `npm run check`: SPA/Qwik TypeScript checks, source builds, **2 schema tests and 15 browser/server/build checks pass**.
- SPA `vitest run --config vitest.config.ts --coverage`: **269 tests pass** (249 on merged base + 20 additions), with **100% published-source statements, branches, functions and lines**. This is not a claim of full experimental-runtime coverage.
- Resumability `vitest run --coverage`: **86 tests pass**, 100% published-source coverage; no changes to that package.
- SPA package and consumer TypeScript checks pass.
- Packed-consumer runtime checks pass in production and development (7 each); optional-peer isolation and production-artifact audit pass.
- Astro resumption browser checks pass in production and development: constant props, async readiness, recovery, live islands, input/focus and ownership. The managed Playwright browser download was unavailable locally; these runs used the experiment's existing Chromium 153 through a temporary launcher override, with repository test source unchanged.
- Scoped ESLint, Oxlint, dprint and git whitespace checks pass.
- Fresh six-variant, 12-card fast-profile harness smoke: correct final quantities and no page errors. This checks function, not performance.

**Not rerun locally:** full monorepo suite, complete Astro browser matrix, peer-environment matrix, and full throttled benchmark batches. Exact-head CI is monitored separately.

The original archive omitted common.ts. Its label, initial-value and setup-counter implementations were recovered directly from the archive's unminified SPA bundle; its Props type was reconstructed from the shared consumers. The rebuilt controls and spike pass the pixel/visible-text comparison. No archived performance sample was rewritten to represent this repair or the added guards.

## Method and reproduction

Chromium 153.0.8010.0 headless shell via `@sparticuz/chromium`, Node 24.22.1, Linux x64, 900×700 viewport. CDP uses 6× CPU slowdown, 150 ms added network latency, 200,000 B/s download and 93,750 B/s upload. A local static server serves gzip level 6. Each performance sample starts a fresh browser, waits for load and verified network quiet (including prefetch downloads), measures CDP ScriptDuration/TaskDuration and compressed bodies, clicks once, clicks five more times, then tests a synchronous all-card burst where applicable. This is an exploratory laboratory measurement, not calibrated device performance or field Core Web Vitals. Large homogeneous card collections stress sparse interaction; they are not claimed to be typical small storefronts.

The included [benchmark.mjs](./benchmark.mjs) was copied from the earlier controlled benchmark with a separate port (4174), state-restoration instrumentation, nonmutating variant-order selection, guaranteed browser cleanup, and explicit network-quiet tracking. Canonical earlier fixtures/results were not edited. The same-batch numbers here replace cross-batch timing comparisons; they need not exactly match the previous report.

An initial 200-card pass succeeded using Playwright's `networkidle` lifecycle. In the large eager-SPA case that lifecycle wait timed out even though `load`, all resource completions, hydration and the DOM were confirmed correct. The final harness therefore waits for zero in-flight requests and 500 ms without request activity after `load`, rather than relying on that lifecycle event; the full comparative batch was rerun with this same rule. Initial/pilot/diagnostic runs are not included in the committed evidence or mixed into the tables.

From this directory, run [reproduce.sh](./reproduce.sh) to install the pinned experiment dependencies, typecheck, build, validate and repeat the benchmark batches. For just correctness, run npm ci --ignore-scripts followed by npm run check. The local server in [serve.mjs](./serve.mjs) serves the generated dist directory on port 4174.

Internal portable host: `host/`. Atom.io adapter, fixture composition and SPA producer: `spike/`. Current-checkout controls: `spa/`, `spa-islands/`. Broader Qwik reference: `qwik/`. Original raw measurements and grouped medians are preserved in evidence/. New measurements are written to ignored output files beside the harness, so reruns do not overwrite that evidence. Browser screenshots are generated locally by validation but are not included in the deliverable. `build/cart.js.meta.json` records the actual client dependency graph; `build/host.meta.json` records the host graph. Do not run multiple benchmark batches concurrently. Build output, screenshots and node_modules are ignored. The isolated npm lockfile pins the reference tools without adding Qwik or Chromium to the workspace package graph.
