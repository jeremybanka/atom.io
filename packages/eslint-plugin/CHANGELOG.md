# @atom.io/eslint-plugin

## 0.1.0

### Minor Changes

- 042656d: Move the ESLint plugin to `@atom.io/eslint-plugin`, where its runtime utilities are ordinary dependencies. Install the new package as a development dependency and replace imports from `atom.io/eslint-plugin` with `@atom.io/eslint-plugin`; rule names, options, and the named `Rules` export are unchanged. Remove the old SDK export and its optional ESLint/parser peers while keeping `atom.io` free of regular dependencies. Update the documentation and starter templates to use the standalone package, and use TypeScript 7 for template builds while providing the TypeScript 6 compiler API for ESLint.
