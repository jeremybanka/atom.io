---
"atom.io": patch
"@atom.io/realtime": patch
---

Add Mosaic Domains, a production-oriented realtime coordination layer over ordinary Atom.io state. Mosaic Domains replicate heterogeneous transactions atomically and add bounded partial residency, presence, incremental checkpoint recovery, actor-scoped undo and redo, authenticated client and server adapters, and reusable multi-client conformance testing. Mosaic Text now uses compact logical runs, stable positions, bounded indexing, and viewport projections for large collaborative Markdown documents. This release also adds canonical realtime Markdown and Preact closed-contour editor templates, deterministic fault validation across both verticals, and a complete realtime documentation section covering the rigid, Atomic Mosaic, and Mosaic Domain paradigms.

Transactions now expose outermost commit records and include `mutable_atom_snapshot` in the public `TransactionSubEvent` union. Consumers with exhaustive switches over transaction subevents must handle this new case; mutable-atom snapshot updates now participate in transaction replay and timelines.
