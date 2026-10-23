---
"@atom.io/react-devtools": minor
---

Release the standalone React devtools at 0.1.0. Replace imports from `atom.io/react-devtools` with `@atom.io/react-devtools` and load styles from `@atom.io/react-devtools/css`; the component exports and behavior are unchanged. Motion is included as a regular dependency. React and React DOM 18 or 19 remain peers, with `atom.io` compatibility declared as `^0.53.3 || ^0.54.0` and React bindings compatibility as `^0.1`.

Generate the package README from MDX with shared branding, package badges, source-backed installation and setup examples, and JavaScript bundle reports that exclude the required stylesheet.

Own devtools behavior tests, consumer fixtures, and coverage reporting in this package, with an independent Recoverage history. Check packed devtools against frozen React 18 and 19 environments using both the released and coordinated SDK.
