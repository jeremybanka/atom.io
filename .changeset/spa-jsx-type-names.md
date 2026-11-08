---
"@atom.io/spa": patch
"@atom.io/spa-devtools": patch
"atom.io": patch
"@atom.io/template-spa-astro-ssr": patch
---

Rename the public VNode type to SpaElement and Child to Children. Update type imports and annotations to the new names; JSX.Element aliases SpaElement, and Component returns Children. Children retains the same recursive union of renderable values, readonly arrays, and accessors, and SpaElement retains the same type and props fields. Update the documentation, examples, Astro starter, and SPA devtools; the devtools now require @atom.io/spa 0.0.5 or newer within the 0.0.x release line for these type exports.
