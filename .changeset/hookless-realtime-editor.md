---
"atom.io": patch
"@atom.io/template-preact-realtime-vector-editor": patch
"@atom.io/template-react-realtime-text-editor": patch
---

Add a Store-owned Mosaic text range controller and supported Lexical adapter so realtime text consumers can compose status, presence, optimistic editing, viewport residency, and collaborator geometry without standard React state or effect hooks. Ship the adapter's component-owned stylesheet as a supported CSS export so consumers can theme it without styling across an ownership boundary. Give both Mosaic templates a pinned, standalone Oxlint, ESLint, TypeScript, and dprint quality baseline.
