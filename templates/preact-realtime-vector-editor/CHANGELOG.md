# @atom.io/template-preact-realtime-vector-editor

## 0.1.3

### Patch Changes

- Updated dependencies [138c640]
- Updated dependencies [138c640]
  - atom.io@0.54.3
  - @atom.io/react@0.2.0
  - @atom.io/realtime@0.1.1
  - @atom.io/template-preact-svg-editor@0.1.4

## 0.1.2

### Patch Changes

- Updated dependencies [a51693d]
- Updated dependencies [a51693d]
- Updated dependencies [a51693d]
  - @atom.io/react@0.2.0
  - atom.io@0.54.2
  - @atom.io/realtime@0.1.1
  - @atom.io/template-preact-svg-editor@0.1.3

## 0.1.1

### Patch Changes

- Updated dependencies [2bbaa59]
  - atom.io@0.54.1
  - @atom.io/react@0.1.0
  - @atom.io/realtime@0.1.0
  - @atom.io/template-preact-svg-editor@0.1.2

## 0.1.0

### Minor Changes

- aa30b42: Provide a Preact collaborative vector editor using Mosaic Domains, with node dragging, insertion and deletion, collaborator presence, offline replay, actor-selective undo and redo, and visible pending or rejected edits.

  Represent the collaborative document as one validated closed straight-line contour of three to sixty-four points. Closure and edges are implicit, preventing dangling edges and invalid branches. This replaces the earlier multi-member path/subpath model; applications based on that model must adapt their document data and operations to the contour representation.

  Use the standalone `@atom.io/react`, `@atom.io/realtime`, and `@atom.io/eslint-plugin` packages. Include pinned Oxlint, ESLint, TypeScript, and dprint quality checks, with TypeScript 7 for builds and TypeScript 6 for ESLint's compiler API. Pin dprint 0.64.1 to distrust the compromised eMudhra certificates when downloading formatter plugins.

### Patch Changes

- Updated dependencies [bb1d8de]
- Updated dependencies [aa30b42]
- Updated dependencies [bb1d8de]
- Updated dependencies [bb1d8de]
  - atom.io@0.54.0
  - @atom.io/realtime@0.1.0
  - @atom.io/react@0.1.0
  - @atom.io/template-preact-svg-editor@0.1.1
