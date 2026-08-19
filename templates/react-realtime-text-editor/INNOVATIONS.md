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

## Mosaic Text v3: Atomic Roots Instead of Giant Operations

A 50 MB import cannot be both a bounded operation and a single giant Domain
payload. Splitting that payload into several accepted source revisions was also
rejected: a crash would expose a prefix, and retry could collide with the
already-accepted prefix or duplicate it. Mosaic Text v3 takes a different path.
It stages immutable content-addressed leaves and bounded-fanout branches while
they are unreachable, protects the staged graph with the same atomic storage
write, and publishes one small root operation. Before that root is accepted the
old document remains authoritative; afterward the complete new graph is
authoritative. Exact retry is idempotent.

This required one model-neutral addition to the MOS-13 checkpoint spine:
checkpoints may name validated external roots. Staging and its expiring proposal
lease are atomic; the accepted append atomically promotes that lease to durable
accepted-root protection; and checkpoint publication adopts and releases the
protection in the same commit. Restart exposes accepted-but-not-yet-checkpointed
roots to the coordinator, while history and outbox leases protect older roots.
Garbage collection traces every edge behind a retention-epoch fence. Missing
parents, stale parents, forged summaries, hash collisions, corrupt objects, and
stage/append/checkpoint/GC races all fail closed. Abandoned proposals expire by
time, revision, and bounded retention epochs instead of becoming perpetual
leases.

The external root stores its incremental proof separately from the root header.
An initial import necessarily reads the whole input once. A later edit
path-copies only the touched leaf and branch path, sends removals for superseded
paths, and verifies its delta against the protected parent summary. Commit can
therefore reuse authenticated subtree totals instead of rehashing a document
manifest. Range recovery is paged and visits addressed paths rather than
hydrating the graph.

This is deliberately versioned as Mosaic Text v3 rather than silently changing
v2's run snapshot. The generic Domain hook knows only content-addressed object
graphs, bounds, and lifecycle dependencies; rope shape, grapheme-safe chunking,
reference counts, range reads, and root replacement remain text-owned. That is
where this work takes its own path beyond the original push/pull and monolithic
checkpoint facilities.

## History and Checkpoint Amplification

Scale auditing also found a non-text-specific amplifier in Domain history.
Accepted gestures were deep-cloned into every retained checkpoint-race cut, so a
large operation could be retained many times even when text storage itself was
segmented. History now clones and freezes accepted JSON once at its trusted
ingress, shares those immutable gesture payloads across race cuts, replaces a
gesture immutably when it is extended, and clones only at public or storage
egress. Caller mutation, malicious compensation callbacks, restart hydration,
and checkpoint observers remain isolated.

Mosaic v2 compaction received a related correctness fix. It removes only retired
runs that are provably unreachable while preserving logical positions, foreign
descendants, undo/redo protection, checkpoints, restart, and duplicate replay.
The scale gate keeps the v2 history/index stabilization loop because those are
the user-facing selective-history and alias contracts, then drives more than
100,000 operations through the real Domain receipt, checkpoint, retention, and
garbage-collection lifecycle.

## Deterministic Release Gate

The MOS-20 manifest is the sole corpus authority. The gate verifies its source
and derived digests before opening the canonical 5.6 MB source, deterministic
50 MB repetition, huge paragraph, fenced block, heading-rich, and adversarial
Unicode variants. A single worker owns one authoritative graph at a time. Each
document runs multi-client disjoint and shared-boundary edits, duplicate,
delayed and reordered delivery, rejection, disconnect/resnapshot, partial
hydration and eviction, split/merge path copies, individualized undo/redo, and
storage-plus-coordinator restart. Failure output includes the seed, fault and
client schedules, frontier, resident ranges, and replay transcript.

The gate never constructs a second full-document oracle. Its independent flat
model is a UTF-16-addressed piece table over the canonical file, and final
verification streams source ranges directly into the digest. Instrumentation
fails the gate if any service read materializes a document larger than the
configured residency bound; clients, parsing, join, and resnapshot remain
bounded projections over the one authoritative segmented graph.

Normative counters cover leaf and branch visits and writes, UTF-16 scanned,
object reads, validation hashing and serialization, bytes persisted, checkpoint
and batch payloads, resident and delivered bytes, selector invalidations, and
parser work. Ordinary edits are bounded to addressed leaves and tree height;
join and parser work are bounded to resident windows; checkpoints reuse clean
objects. The 100,001-operation stabilization assertion bounds history, aliases,
receipts, tail, sessions, and live checkpoint objects. Elapsed time and RSS are
reported observations only because runner load and allocator behavior are not
deterministic correctness signals.

Current architecture limits are explicit: text leaves target 32,768 graphemes
and at most 65,536 UTF-16 units; import chunks are at most 262,144 UTF-16 units;
branches contain at most 32 children; one edit inserts at most 256 KiB; a range
read defaults to 128 objects; external graphs default to depth 64, 64 roots, 256
recovery reads, 1 GiB aggregate bytes, and 4 MiB per object; proposal retention
defaults to 64 epochs and is limited to 1–1,024. These are safety contracts, not
claims that arbitrarily large documents are fully resident.

The zero-setup editor server remains in-memory and uses simulated authorization.
A product adapter must provide the linearizable semantics exercised by the
in-memory conformance adapter, plus durable ACLs, rate limits, observability, and
an offline-retention policy.
