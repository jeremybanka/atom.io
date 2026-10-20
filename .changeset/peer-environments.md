---
"atom.io": patch
"@atom.io/react": patch
"@atom.io/solid": patch
"@atom.io/react-devtools": patch
"@atom.io/eslint-plugin": patch
---

Test packed integrations against frozen released and coordinated peer environments before release. Declare SDK compatibility explicitly as `^0.53.3 || ^0.54.0` and accept compatible React-adapter patch releases with `~0.0.0`, preserving support when workspace versions advance. Move integration behavior tests and shared consumer fixtures into their owning packages, with package-local test and coverage commands and a combined repository coverage report.
