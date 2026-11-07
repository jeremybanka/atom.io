# SPA behavior-resumption spike

## Result

**A narrowly restricted, opt-in behavior-resumption path works on the current PR's server renderer and atom.io engine.** A click loads one addressable handler, restores only its captured numeric atoms and direct text bindings, and updates the existing DOM without importing or running the component, SPA's hydrator, or the full island.

This is a **manual proof of the boundary**, not an automatic compiler feature or a general-purpose alternative to Qwik. It lives in a repository-only experiment with no package exports and does not change the normal SPA hydrator or the independent resumability package.

Based on [Atom.io PR #1465](https://github.com/jeremybanka/atom.io/pull/1465), pinned to [`d0a655a9ec05982ffe7af26f9920a2d9dbf07182`](https://github.com/jeremybanka/atom.io/tree/d0a655a9ec05982ffe7af26f9920a2d9dbf07182). The archived measurements bundle that exact PR compiler, SSR and atom.io state-engine source with production flags. The repository harness now bundles the current checkout; it does not silently fetch another source revision. Qwik 1.20.3 is a broader reference control, not an equal-capability competitor to this specialized path.

## What is actually implemented

The fixture is the same storefront as the preceding benchmark: product cards each have an Add to bag button, a per-product quantity, and one shared cart total. The spike's initial rendering has the same visible text and pixel-identical screenshots as eager SPA for 12 cards.

### 1. Server runs ordinary component setup and renders with SPA

`spike/server.tsx` uses the current PR's JSX compiler, `renderToString`, `useGetter`, and actual atom.io atoms. Server-only component setup computes titles and reads state. Explicit annotations are authored alongside that markup; they are **not extracted by the compiler**.

The emitted button carries an addressable handler export and a JSON array of captured cell IDs. Each cell has a separate inert JSON record containing its finite numeric value and direct text-target IDs. See the executable [server fixture](./spike/server.tsx) for the markup.

The original SPA SSR comment markers remain in the actual output. All state records still arrive and are parsed as HTML upfront. State is stored in separate records so first interaction does not JSON-decode a 1,001-cell global snapshot.

### 2. One small loader captures clicks

`spike/loader.ts` is inlined as a classic script in the document head. It is **699 minified bytes, 473 gzip bytes in isolation**; whole-page compressed sizes below already include it. It installs one delegated click listener, finds the annotated non-submit button, and imports the module named by the address. Module promises are shared, and a promise queue retains click order while loading. No state records or component tree are scanned at startup.

The address is restricted to an app-owned `/resume/<name>.js#<export>` route. The handler receives the button, not an arbitrary serialized event object. Keyboard Enter/Space works because native buttons dispatch click.

### 3. Only captured cells and text subscriptions are restored

`spike/cart.ts` exports `addToBag`. Its bundle includes `spike/runtime.ts` and the **actual atom.io state engine**, not a substitute counter implementation.

On the first click, `capture(button)` reads `q0` and `cart`, parses only those two JSON records, resolves the named existing text nodes, creates one shared store and two atom.io atoms with the **serialized values**, and installs two atom.io subscriptions. The handler increments both atoms. Subscriptions update `Text.data`, keeping the DOM elements, text nodes and SSR comments intact.

On a later click of another card, only that card's atom/binding is added; the shared cart already exists. Clicking product 999 on a 1,000-card page still starts with only **two atoms and two bindings**, not 1,001. There is no client component setup, full tree traversal, or SPA hydration call. There **is** small, lazy runtime work to materialize the captured cells and their subscriptions; this does not eliminate all first-use setup. It recreates the declared small graph, not the original JavaScript closure or subscription objects.

### 4. Cold versus preloaded behavior

- **Cold:** only the inline loader executes/downloads initially. The handler plus atom engine is fetched on the first click.
- **Preloaded:** a head `modulepreload` downloads and may parse/compile the handler bundle early. It does not evaluate that module, create the store, or run component setup until click. This shifts download cost earlier to reduce first-interaction delay.

The handler/runtime/atom bundle is **35,625 minified bytes / 10,512 gzip bytes**. Eager SPA's equivalent fixture bundle is **44,595 / 14,120 bytes**. Thus this experiment does not make atom.io disappear: almost all the deferred bytes are the real state engine and its imported machinery.

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

- Pixel and visible-text equivalence with the current PR fixture.
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

In the archived run, all **48 settled-performance samples** have correct final cart/quantities and no page errors. All **15 early-input samples** updated the cart with no page errors. The two schema tests and all 11 browser/build validation checks pass.

The focused TypeScript check uses the checkout's compiler options plus DOM libraries and passes. Unused-parameter reporting is disabled because source-bundling includes an existing unused generic. This is not a complete monorepo lint/test or Astro integration run.

### Deliberately unsupported

- Automatic closure extraction or capture analysis, arbitrary JS object graphs, functions, class instances, promises, cycles, computed selectors, effects, mutable atoms, timelines, or external atom-store interoperability.
- Structural/conditional rendering, list reconciliation, changing attributes, SVG, graphics, refs, mount callbacks or component cleanup. Only dedicated finite-number text containers with stable document-wide IDs are accepted.
- General event replay semantics, forms, navigation, default-action cancellation, event modifiers or event-object capture. Only ordinary `type="button"` click behavior is tested.
- Independent event scheduling: the simple global queue could let a future slow/asynchronous handler delay unrelated buttons. The tested handler is synchronous.
- Multiple independently versioned roots, SPA/Astro client navigation, hydration/resumption ownership transitions, streaming coordination, snapshot updates for reserialization, or disposal of removed atom subscriptions. State and bindings live for this document; detached text writes are skipped.
- Production error UI, deployment/version manifests, content-hashed module addresses, and CSP nonce/hash integration for the inline loader. The loader raises a `resume-error` DOM event; it is not production recovery UX.

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

## Where the general-purpose boundary belongs

The protocol can be general-purpose; the implementation is not independent today.

- **Portable mechanism:** the click loader, export addresses, capture IDs, individually decoded records and binding addresses do not inherently require atom.io, SPA or Astro. A future core could accept state and binding adapters. Even the direct-text binding contract could serve another renderer.
- **Atom.io adapter:** [runtime.ts](./spike/runtime.ts) deliberately uses Store, atom creation, reads, writes and subscriptions from atom.io/internal. It currently creates a private document-lifetime store. This does not interoperate with an existing application store or resume arbitrary atom families, selectors, transactions or timelines.
- **SPA adapter/compiler:** [server.tsx](./spike/server.tsx) uses SPA rendering and hooks. Automatic extraction, identifying eligible reads/setters, SSR binding placement and fallback decisions must understand SPA semantics. Another renderer would need its own producer/compiler adapter.
- **Astro integration:** route lifetime, streaming order and ownership of the existing data-resumption scope belong in integration code. The current experiment runs as static fixtures and does not claim Astro integration.

Keep the independent resumability package focused on its existing producer/codec/scope contract. There is no reason to make that package import SPA or atom.io just to carry this experiment. First prove the compiler-generated contract and another real consumer; then decide whether a small standalone behavior core is justified. Dependency inversion is plausible because the coupling is localized, but extraction before a second consumer would be an untested abstraction.

## Repository integration and verification

The committed evidence is historical. This integration makes the fixture reproducible from a checkout and adds focused regression tests without publishing new SPA entrypoints. It also rejects non-finite client writes/server initial values and actually asserts preservation of existing text/comment nodes. Those guards do not establish arbitrary-state support.

Current integration validation:

- Experiment and control TypeScript checks, source builds, two schema tests and all 14 browser/server/build checks pass.
- SPA's 247 tests pass, including 11 added regressions. The existing published-src coverage gate remains 100% in all four metrics; that gate does not claim 100% coverage for the experiment itself.
- SPA package/consumer types, production-artifact checks, development/production packed-consumer tests, optional-peer isolation, and scoped ESLint/Oxlint/format checks pass.
- A fresh six-variant, 12-card fast-profile harness smoke run has correct final quantities and no page errors. It is a functional harness check, not a replacement for the archived throttled measurements.
- The full monorepo, Astro browser matrix, peer-environment matrix, and full throttled performance batches were not rerun for this integration.

The original archive omitted common.ts. Its label, initial-value and setup-counter implementations were recovered directly from the archive's unminified SPA bundle; its Props type was reconstructed from the shared consumers. The rebuilt controls and spike pass the pixel/visible-text comparison. No archived performance sample was rewritten to represent this repair or the added guards.

## Method and reproduction

Chromium 153.0.8010.0 headless shell via `@sparticuz/chromium`, Node 24.22.1, Linux x64, 900×700 viewport. CDP uses 6× CPU slowdown, 150 ms added network latency, 200,000 B/s download and 93,750 B/s upload. A local static server serves gzip level 6. Each performance sample starts a fresh browser, waits for load and verified network quiet (including prefetch downloads), measures CDP ScriptDuration/TaskDuration and compressed bodies, clicks once, clicks five more times, then tests a synchronous all-card burst where applicable. This is an exploratory laboratory measurement, not calibrated device performance or field Core Web Vitals. Large homogeneous card collections stress sparse interaction; they are not claimed to be typical small storefronts.

The included [benchmark.mjs](./benchmark.mjs) was copied from the earlier controlled benchmark with a separate port (4174), state-restoration instrumentation, nonmutating variant-order selection, guaranteed browser cleanup, and explicit network-quiet tracking. Canonical earlier fixtures/results were not edited. The same-batch numbers here replace cross-batch timing comparisons; they need not exactly match the previous report.

An initial 200-card pass succeeded using Playwright's `networkidle` lifecycle. In the large eager-SPA case that lifecycle wait timed out even though `load`, all resource completions, hydration and the DOM were confirmed correct. The final harness therefore waits for zero in-flight requests and 500 ms without request activity after `load`, rather than relying on that lifecycle event; the full comparative batch was rerun with this same rule. Initial/pilot/diagnostic runs are not included in the committed evidence or mixed into the tables.

From this directory, run [reproduce.sh](./reproduce.sh) to install the pinned experiment dependencies, typecheck, build, validate and repeat the benchmark batches. For just correctness, run npm ci --ignore-scripts followed by npm run check. The local server in [serve.mjs](./serve.mjs) serves the generated dist directory on port 4174.

Main source: `spike/`. Current-checkout controls: `spa/`, `spa-islands/`. Broader Qwik reference: `qwik/`. Original raw measurements and grouped medians are preserved in evidence/. New measurements are written to ignored output files beside the harness, so reruns do not overwrite that evidence. Browser screenshots are generated locally by validation but are not included in the deliverable. `build/cart.js.meta.json` records the actual client dependency graph. Do not run multiple benchmark batches concurrently. Build output, screenshots and node_modules are ignored. The isolated npm lockfile pins the reference tools without adding Qwik or Chromium to the workspace package graph.
