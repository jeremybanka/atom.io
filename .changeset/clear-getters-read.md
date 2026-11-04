---
"@atom.io/spa": minor
"@atom.io/spa-devtools": minor
"atom.io": patch
---

Rename SPA's `useValue` hook to `useGetter` to reflect that it returns a getter function and pair it with `useSetter`. Update imports and calls to `useGetter`; token and family/key overloads, store binding, and reactive behavior are unchanged. Migrate SPA devtools, examples, and published documentation, and require SPA 0.1.x in SPA devtools.
