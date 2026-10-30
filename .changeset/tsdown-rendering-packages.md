---
"@atom.io/spa": patch
"@atom.io/spa-devtools": patch
"resumability": patch
---

Build SPA, SPA devtools, and resumability with the repository's tsdown toolchain, including bundled declarations and shared runtime chunks. Preserve SPA's development condition, reactive JSX compilation for devtools, packaged CSS and Astro assets, and separate browser size audits. Use standard tsdown output without custom property mangling, increasing SPA's client audit from 3,288 to 3,358 gzip bytes and its limit to 3,400 bytes. Include SPA's upcoming 0.1 release in the devtools peer range.
