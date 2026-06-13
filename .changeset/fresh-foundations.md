---
"atom.io": minor
---

Add public foundation submodules for overlays and junctions.

`MapOverlay`, `RelationsOverlay`, and `SetOverlay` are now available from `atom.io/foundations/overlays`, while `Junction` and its related types are now available from `atom.io/foundations/junction`. These APIs are no longer exported from `atom.io/internal`.

Overlay iteration now preserves source ordering before overlay-only entries, with cleared source entries reinserted in fresh insertion order.
