---
"atom.io": patch
"@atom.io/eslint-plugin": patch
"@atom.io/template-preact-svg-editor": patch
"@atom.io/template-react-node-backend": patch
"@atom.io/template-react-realtime-text-editor": patch
"@atom.io/template-solid-lossless-numbers": patch
---

Publish the ESLint integration as `@atom.io/eslint-plugin` with ESLint and parser version 8 peers and transitive utility dependencies. Remove tooling peers from the core runtime so parser resolutions do not split its pnpm identity, preserve `atom.io/eslint-plugin` as a bundled compatibility export, and update the templates and migration documentation.
