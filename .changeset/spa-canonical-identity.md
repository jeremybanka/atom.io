---
"@atom.io/spa": patch
"@atom.io/spa-devtools": patch
"atom.io": patch
---

Use atom.io Canonical values as SPA keys in DOM and scene trees. Components can read the original key through props.key and bind family hooks to it during setup. Changing a key replaces the instance in any position, and equal tuple keys preserve it. Null is now a key, undefined remains positional, and numeric keys compare separately from strings. Duplicate sibling keys now also throw in production DOM builds.

Keep ordinary lazy key expressions in the same props object as data attributes. Direct DOM component and root output track identity when a key property is present at mount, including an initial undefined value. Keyless direct spreads update data props without allocating a reactive child collection.
