---
"atom.io": patch
"@atom.io/spa": minor
"@atom.io/spa-devtools": patch
"@atom.io/template-spa-astro-ssr": patch
---

Simplify the SPA setup examples to a single counter, present Astro before Vite, and show only the setup each framework requires. Remove unrelated lifecycle helpers, slots, initial props, and custom stores from the Astro counter, and keep the point example focused on reactive state. Use ordinary .tsx component filenames throughout the SPA exhibits, debugger setup, and Astro starter. The Astro integration now compiles .tsx and .jsx files by default; applications using multiple JSX renderers must use include to select their SPA component directories.
