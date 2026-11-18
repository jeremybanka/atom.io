---
"@atom.io/template-react-node-backend": patch
"@atom.io/template-preact-realtime-vector-editor": patch
"@atom.io/template-preact-svg-editor": patch
"@atom.io/template-react-realtime-text-editor": patch
---

Use typescript-compiler for TypeScript 7 builds in generated projects, avoiding typescript-eslint’s incompatible optional native-parser peer while retaining TypeScript 6 for linting.
