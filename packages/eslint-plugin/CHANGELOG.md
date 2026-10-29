# @atom.io/eslint-plugin

## 0.1.1

### Patch Changes

- a51693d: Add the opt-in `atom.io/ban-use-effect` rule to reject React `useEffect` imports and references while allowing `useLayoutEffect`. Diagnostics link to the “against useEffect” web guide and its local copy in `node_modules/atom.io/docs/agent/packages/against-use-effect.md`.

## 0.1.0

### Minor Changes

- 042656d: Release the standalone ESLint plugin at 0.1.0. Install it as a development dependency and replace imports from `atom.io/eslint-plugin` with `@atom.io/eslint-plugin`; the default plugin export, named `Rules` export, rule names, and options are unchanged. Runtime utilities are ordinary dependencies of this package.

  Support ESLint 9 or 10, `@typescript-eslint/parser` 8, and the TypeScript compiler API from 4.8.4 through 6.0.x. The TypeScript peer is for ESLint's compiler API and does not prevent applications from using a separate TypeScript 7 compiler for builds.

  Generate the package README from MDX with shared branding, package badges, source-backed installation and configuration examples, and a rule table derived from plugin metadata. Own rule tests and coverage reporting in this package, with an independent Recoverage history and frozen ESLint 9 and 10 compatibility environments.
