---
"@atom.io/spa": patch
---

Resolve a lone JSX spread through the lazy props merger so self-closing elements and components retain attributes, event handlers, refs, keys, and forwarded props. Preserve reactive updates and keyed component identity during rendering and hydration.
