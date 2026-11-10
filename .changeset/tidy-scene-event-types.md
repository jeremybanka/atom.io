---
"@atom.io/spa": patch
"atom.io": patch
---

Accept SVG focusable attributes and preserve literal boolean values during rendering and hydration, narrow relatedTarget on DOM focus and mouse handlers, and type Konva mouse, pointer, touch, wheel, drag, transform, and pointer capture handlers with native events and node-specific currentTarget values. Allow transform completion without a native event when stopped programmatically. Reject misspelled Konva configuration and handler names and document the supported event families.
