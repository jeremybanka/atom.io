---
"@atom.io/spa": patch
---

Export animated BrandMark via @atom.io/spa/brand, with @atom.io/spa/brand/css and @atom.io/spa/brand/model entrypoints. Add PointLight and batched line components to the Three.js integration, and motion:layoutRoot for animations inside movable containers. Preserve mount options during hot updates, reduce DOM, layout and idle-rendering work, and recover from renderer setup failures.
