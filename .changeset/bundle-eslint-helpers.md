---
"atom.io": patch
---

Fix `atom.io/eslint-plugin` failing to load when `@typescript-eslint/utils` is not installed by bundling only the rule-creation and parser-service helpers it uses. Keep the existing import path and optional ESLint/parser peers, preserve zero regular dependencies, and expose ESLint-native plugin and rule declarations without requiring authoring utility packages in consumers.
