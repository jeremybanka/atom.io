---
"@atom.io/eslint-plugin": patch
"atom.io": patch
"@atom.io/template-react-node-backend": patch
"@atom.io/template-solid-lossless-numbers": patch
"@atom.io/template-preact-realtime-vector-editor": patch
"@atom.io/template-preact-svg-editor": patch
"@atom.io/template-react-realtime-text-editor": patch
---

Use a neutral alias for the standalone TypeScript 7 build compiler so it does not conflict with typescript-eslint’s optional native-parser API peer, while retaining TypeScript 6 for ESLint and the existing tsc and tsc6 commands. Update the installation guidance and preserve strict peer validation in packaging checks.
