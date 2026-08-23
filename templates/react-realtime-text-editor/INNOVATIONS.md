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

The mounted Lexical plain-text editor contains only one resident source window.
The renderer-neutral Mosaic text editor hook keeps keystrokes in an optimistic
draft, derives minimal replacement intent, and retains that draft until a
complete newer projection cut settles. It also publishes local selections as
run-relative positions and resolves collaborator selections through the same
visible text deltas, so renderers do not briefly display an absolute cursor at a
stale offset. DOM selection, composition, scroll, and caret geometry remain
renderer-owned.

Lexical is deliberately a browser editing and geometry layer rather than a
second collaboration authority. Its Yjs collaboration integration and history
plugin are not mounted. Mosaic owns accepted text, convergence, logical
positions, actor history, partial residency, and renewable presence leases. The
core editor lifecycle projects the current bounded source, translates local
selection offsets into Mosaic positions, and resolves foreign positions. The
Lexical adapter only maps those offsets to DOM ranges for colored caret labels
and selection overlays. A projection-tagged update cannot echo back as a local
edit, while native composition remains local until it is ready for the existing
coalesced Domain gesture.

The React range hook now reacquires a failed viewport when residency transitions
back to live. This closes the cold-start race where Vite could render before the
realtime server accepted its first Socket.IO connection, leaving an otherwise
healthy client permanently parked on an internal resnapshot error.

An accepted edit may also shorten a document while an existing subscription
still names the old viewport end. The Markdown range adapter therefore clamps
that durable subscription to the new authoritative length, and command
acknowledgements do not clear the optimistic draft until residency has settled
the accepted revision. This prevents a valid remote replacement from stranding
the UI on a stale projection or briefly presenting the stale text as saved.

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
hydration and eviction, individualized undo/redo, and storage-plus-coordinator
restart. The seed shuffles the client, delivery, and lifecycle fault order that
is actually executed. Failure output includes that seed, the realized fault and
client schedules, resident ranges, source and client revisions, and a bounded
semantic transcript containing the exact commands needed for replay.

The gate never constructs a second full-document oracle. Its independent flat
model is a UTF-16-addressed piece table over the canonical file, and final
verification streams source ranges directly into the digest. The same pass
independently counts graphemes, line breaks, and UTF-16 units and reconstructs
each client's bounded resident ranges; all are compared with the published root
summary and client projections. Instrumentation fails the gate if any service
read materializes a document larger than the configured residency bound;
clients, parsing, join, and resnapshot remain bounded projections over the one
authoritative segmented graph.

Normative counters cover leaf and branch visits and writes, UTF-16 scanned,
object reads, validation hashing and serialization, bytes persisted, checkpoint
and batch payloads, resident and delivered bytes, selector invalidations, and
parser work. Ordinary edits are bounded to addressed leaves and tree height;
join and parser work are bounded to resident windows; checkpoints reuse clean
objects. A local checkpoint may persist at most 512 KiB and a viewport transfer
or accepted delivery at most 384 KiB. The 100,001-operation stabilization
assertion bounds history, aliases, receipts, tail, sessions, and live checkpoint
objects, then forces a real index split, resolves its stale leaf alias through
the public reader, and verifies the leaves merge after contention settles.
Elapsed time and RSS are reported observations only because runner load and
allocator behavior are not deterministic correctness signals.

Current architecture limits are explicit: text leaves target 32,768 graphemes
and at most 65,536 UTF-16 units; import chunks are at most 262,144 UTF-16 units;
branches contain at most 32 children; one edit inserts at most 256 KiB; a range
read defaults to 128 objects; an external graph defaults to 64 MiB total while
one staging call may add at most 16 MiB across 4,096 objects and 256 logical
updates, with 4 MiB and depth 64 per object; and a coordinator defaults to 64
roots, 256 recovery reads, and 64 MiB aggregate external bytes. Proposal
retention defaults to 64 epochs and is limited to 1–1,024. These are safety
contracts, not claims that arbitrarily large documents are fully resident.

External staging is a trusted server composition seam, not a socket protocol.
Client intents first cross Domain authorization and proposal limits; a product
that derives external updates from an untrusted request must also apply its own
per-document quota, rate limit, and deadline before hashing begins. Stage work
is counted before content hashing, checks an abort signal and absolute deadline
between bounded units, and becomes visible with its proposal lease only after
the whole attempt succeeds. The pinned 50 MiB corpus gate raises the incremental
stage budget because its input is authenticated by the MOS-20 manifest and read
under a fixed deadline. That exception is not the default production request
budget: it permits at most 128 MiB of cumulative authenticated staging work and
32,768 objects while the ordinary defaults remain 16 MiB and 4,096 objects. The
reported text-stage bytes count every immutable text or index node serialized
and hashed at the model boundary; directory and proof staging, then storage
verification, independently enforce the same work budget before publication.
These cumulative work budgets are not retained bytes, resident memory, or the
protected graph's 64 MiB value-size cap.

The zero-setup editor server remains in-memory and uses simulated authorization.
A product adapter must provide the linearizable semantics exercised by the
in-memory conformance adapter, plus durable ACLs, rate limits, observability, and
an offline-retention policy.
