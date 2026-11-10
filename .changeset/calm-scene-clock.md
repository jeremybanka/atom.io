---
"@atom.io/spa": patch
---

Keep scene frame callbacks on Motion's animation frame cadence when layout projection flushes rendering work, preventing state writes in onSceneFrame and Canvas onFrame from reentering the scene clock and freezing the page.
