---
"@atom.io/template-preact-realtime-vector-editor": minor
---

Provide a Preact collaborative vector editor using Mosaic Domains, with node dragging, insertion and deletion, collaborator presence, offline replay, actor-selective undo and redo, and visible pending or rejected edits.

Represent the collaborative document as one validated closed straight-line contour of three to sixty-four points. Closure and edges are implicit, preventing dangling edges and invalid branches. This replaces the earlier multi-member path/subpath model; applications based on that model must adapt their document data and operations to the contour representation.

Use the standalone `@atom.io/react`, `@atom.io/realtime`, and `@atom.io/eslint-plugin` packages. Include pinned Oxlint, ESLint, TypeScript, and dprint quality checks, with TypeScript 7 for builds and TypeScript 6 for ESLint's compiler API. Pin dprint 0.64.1 to distrust the compromised eMudhra certificates when downloading formatter plugins.
