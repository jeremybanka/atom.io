---
"atom.io": minor
---

Add a public foundation submodule for overlays.

`MapOverlay`, `RelationsOverlay`, and `SetOverlay` are now available from `atom.io/foundations/overlays`. These APIs are no longer exported from `atom.io/internal`.

Overlay iteration now preserves source ordering before overlay-only entries, with cleared source entries reinserted in fresh insertion order.
