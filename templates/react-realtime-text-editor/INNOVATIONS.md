# Incremental Markdown Decisions

MOS-18 is the first application that composes the run-text model, bounded text
index, partial residency, Domain history, and renderer projections as one user
experience. Most of the implementation is application composition. One missing
generic seam had to move into realtime core so the result could remain correct
at every accepted revision.

## One Logical Source, Bounded Resident Views

The authoritative service owns one Mosaic run-text checkpoint and the MOS-15
bounded-fanout index derived from it. The index root, nodes, aliases, and leaves
are ordinary durable Domain members. A browser never acquires the source member:
MOS-12 authorizes and hydrates only the root and the leaves resolved for a
bounded UTF-16 range, and MOS-17 projects those leaves through ordinary
selectors. Full materialization remains an explicit command.

This is not application-authored paragraph or file sharding. Syntax cannot
change storage shape, so a huge paragraph or fenced block crosses the same
physical thresholds as ordinary prose. Presence and render keys name logical
run positions rather than physical leaves.

MOS-18 exposed a scalability flaw that small MOS-15 conformance fixtures could
not: index composition expanded every source grapheme into a separate JavaScript
object. The core index now streams large fragments into bounded spans, caches
unchanged source spans on the resulting index bundle, and reuses physical leaf
ownership. Ordinary edits scan run/span identities and touch changed leaves plus
their bounded tree paths; they do not manufacture a document-sized unit array.

The same exercise exposed that `replace-text` is the wrong input seam for a
large editor because it materializes and diffs the entire old and new strings.
Mosaic Text now accepts a logical `replace-selection` intent and exposes pure
`prepare` and `preview` phases. The authoritative service can derive a bounded
operation and its next visible run projection before proposing the atomic
Domain batch, without mutating accepted state or asking the application to
construct CRDT runs. Unicode chunking is streaming, preserves CRLF and complex
grapheme boundaries, and remains core-owned rather than application sharding.

## Atomic History Completion

MOS-16 previously generated a correct run-text compensation but had no way to
include the index maintenance describing that compensated text. Appending
maintenance afterward would expose one revision whose source and range index
disagreed.

The history coordinator now accepts an optional `completeCompensation` callback.
It runs after member policies create compensation operations and before the
private history proposal is preflighted. Returned operations join that same
batch only when their member policies classify them as history-free. The
coordinator still proves that the original target set was compensated exactly;
an appended change or second compensation fails closed. This seam is generic to
derived durable indexes and contains no Markdown branch.

## Local Input and Logical Presence

The mounted textarea contains only one resident source window. Keystrokes update
a local draft immediately, minimal replacement intent is derived from the draft,
and reconnect delivery retains its gesture identity and sequence. Local DOM
selection, composition, scroll, and pending input remain React-local. Published
presence converts them to run-relative positions, so collaborators can resolve
them against another partial working set or simply report that the actor is in a
different viewport.

The demo deliberately coalesces an offline draft for its current viewport. It
does not claim semantic intent recovery for arbitrary rewrites made in several
unloaded regions. A richer product can retain several bounded draft windows and
still submit them as one Domain gesture.

## Incremental, Cancelable Semantics

Parsing is not a render-time whole-document function. The headless parser caches
input and output block state, yields after a bounded amount of UTF-16 work, and
cancels an obsolete generation as soon as a newer projection arrives. Fence
state propagates through following blocks only until an unchanged cached input
state establishes a stable boundary. React mounts only semantic blocks in the
current preview window.

The included grammar is intentionally a safe illustrative Markdown subset. A
production CommonMark/GFM worker can replace it behind the same source-block,
cancelation, stable-state, and instrumentation contract. Sanitization remains a
renderer responsibility; this template creates React nodes and never injects
HTML.

## Import, Corpus, and Recovery Boundaries

Reset/import is one authorized Domain proposal containing the source operation
and all index maintenance. It is not a browser initialization effect. Ordinary
joins request only their viewport. The corpus gate opens each pinned source
through the actual Markdown Domain service as one authorized source-and-index
batch, performs logarithmic index lookups, and then uses the exact virtual-window
and parser path against the 5.6 MB source and repeated 50 MB variant. It asserts
bounded batch, range, materialization, and mounted-block work at three
deterministic positions.

The zero-setup server is intentionally in-memory. Restart durability requires
the MOS-13 checkpoint coordinator plus a transactional storage adapter; the core
already supplies those facilities, but pretending the demo adapter survives a
process loss would give users a false guarantee. Client range resnapshot,
split/merge invalidation, reconnect delivery, and selective history are covered
without weakening that production boundary.
