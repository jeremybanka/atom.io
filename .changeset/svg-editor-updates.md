---
"@atom.io/template-preact-svg-editor": patch
---

Expose reusable contour, convergence, Domain, and editor-model modules for collaborative consumers while retaining the local Bezier editor. Harden subpath reordering against selective-undo holes. Report rejection using each contour edit's own submission receipt so another edit or accepted broadcast cannot overwrite its outcome.

Use the standalone `@atom.io/react`, `@atom.io/realtime`, and `@atom.io/eslint-plugin` packages. Build with TypeScript 7 while providing TypeScript 6 for ESLint's compiler API. Pin dprint 0.64.1 to distrust the compromised eMudhra certificates when downloading formatter plugins.
