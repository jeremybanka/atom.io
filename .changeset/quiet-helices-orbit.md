---
"@atom.io/spa": patch
"@atom.io/spa-devtools": minor
"atom.io": patch
---

Replace the ecology grid with a Three.js scene rendered through SPA: opposed atom and selector helices, viewer-facing DOM cards, mouse and touch orbit/pan/zoom controls, tangent family expansion, and softly translucent curved dependency arrows that retain parallel edges. Automatically emphasize the selected node’s upstream and downstream paths without following side branches, fade unrelated cards, clear selection with Escape, expand selected families with Enter, and distinguish subtle keyboard focus from the stronger selection outline. Match the cylinder proportions to the canvas, preserve relative camera framing across resize, and give the selected graph precedence in card and edge stacking. Preserve passive capture, search, tracing and the accessible node list, including a local WebGL fallback. Require SPA 0.0.10 or newer for the new Three.js components and Canvas options. Add batched line resources, idle GPU draw gating and recoverable renderer creation to SPA’s optional Three.js integration.
