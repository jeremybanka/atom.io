# @atom.io/realtime

Realtime collaboration for atom.io. Read the package-owned guides in `docs/source/pages/docs/realtime/` and the typechecked examples in `docs/source/exhibits/realtime/` before changing a public contract.

- Shared models and protocol: `@atom.io/realtime`.
- Framework-neutral clients: `@atom.io/realtime/client`.
- Node and Socket.IO servers: `@atom.io/realtime/server`.
- React bindings and Lexical adapter: `@atom.io/realtime/react` and `@atom.io/realtime/react/lexical`.
- Test clients: `@atom.io/realtime/testing/headless` and `@atom.io/realtime/testing/react`.

The package owns its tests under `__tests__`. Run checks through Turbo. Coverage retains the existing realtime boundary and is guarded by Recoverage; there is currently no 100% `cov:public` gate for this package.
