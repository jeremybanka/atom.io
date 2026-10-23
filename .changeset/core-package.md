---
"atom.io": minor
---

Remove the React, Solid, React devtools, ESLint, and realtime entry points from the core SDK. Install the corresponding standalone packages and replace imports from `atom.io/react`, `atom.io/solid`, `atom.io/react-devtools`, and `atom.io/eslint-plugin` with `@atom.io/react`, `@atom.io/solid`, `@atom.io/react-devtools`, and `@atom.io/eslint-plugin`. Devtools styles now come from `@atom.io/react-devtools/css`. Replace `atom.io/realtime` with `@atom.io/realtime` and the old `realtime-client`, `realtime-server`, `realtime-react`, and `realtime-testing/*` subpaths with that package's `/client`, `/server`, `/react`, and `/testing/*` entries. Remove the extracted integrations' optional peers; the core SDK and `atom.io/testing` remain free of regular dependencies.

Expose isolated outermost transaction commit records through `Store.on.transactionCommit`. Add `mutable_atom_snapshot` to the public `TransactionSubEvent` union so mutable-atom snapshot writes participate in transaction replay and timelines. Consumers with exhaustive subevent switches must handle the new case.

Update the shipped guides and installation exhibits for the standalone integrations. Generate the complete README from `README.mdx` with shared branding, a generated-file notice, source-backed installation instructions, and bundle reports using Tonnage 0.3.0 and Galley 0.1.4. Point the coverage badge at the current Recoverage project; the existing tonnage commands now generate and check the complete README.
