---
"atom.io": minor
"@atom.io/react": patch
"@atom.io/solid": patch
"@atom.io/react-devtools": patch
"@atom.io/template-preact-svg-editor": patch
"@atom.io/template-react-node-backend": patch
"@atom.io/template-react-realtime-text-editor": patch
"@atom.io/template-solid-lossless-numbers": patch
"create-atom.io": patch
---

Move the React bindings, Solid bindings, and React devtools into `@atom.io/react`, `@atom.io/solid`, and `@atom.io/react-devtools`. Install the corresponding package and replace the old `atom.io/react`, `atom.io/solid`, and `atom.io/react-devtools` imports, including `@atom.io/react-devtools/css` for styles. Framework runtimes remain peers of their integrations, and Motion becomes a regular dependency of the devtools. Update starter templates and shipped documentation. Realtime moves into `@atom.io/realtime` in the accompanying extraction and uses the standalone React bindings through an optional peer; `atom.io/testing` remains dependency-free.
