---
"atom.io": patch
---

Fix `atom.io/eslint-plugin` failing to load when `@typescript-eslint/utils` is not installed by bundling only the rule-creation and parser-service helpers it uses. Keep the existing import path, optional ESLint/parser peers, and public rule types while preserving zero regular dependencies. Include the necessary rule declarations so consumers do not need authoring utility packages, and validate the runtime bundle independently of its output filename.
