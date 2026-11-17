---
"@atom.io/spa": patch
"@atom.io/spa-devtools": minor
"atom.io": patch
---

Replace the ecology grid with a Three.js scene rendered through SPA: opposed atom and selector helices, viewer-facing DOM cards, mouse and touch orbit/pan/zoom controls, tangent family expansion, and softly translucent curved dependency arrows that retain parallel edges. Automatically emphasize the selected node’s upstream and downstream paths without following side branches, fade unrelated cards, clear selection with Escape, and expand selected families with Enter. Preserve passive capture, search, tracing and the accessible node list, including a local WebGL fallback. Require SPA 0.0.10 or newer for the new Three.js components and Canvas options. Add batched line resources, idle GPU draw gating and recoverable renderer creation to SPA’s optional Three.js integration.
