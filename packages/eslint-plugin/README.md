# @atom.io/eslint-plugin

ESLint rules for atom.io state and transaction declarations. Install this package as a development dependency alongside ESLint 9 or 10, `@typescript-eslint/parser` 8, and a supported TypeScript compiler (4.8.4 through 6.0.x).

The TypeScript peer describes the compiler API used by ESLint. You can build with TypeScript 7 alongside it: the starter templates alias TypeScript 7 as `@typescript/native` for `tsc` and `@typescript/typescript6` as `typescript` for ESLint's compiler API and the separate `tsc6` command.

The `exact-catch-types` rule requires a TypeScript parser configured with type information. Configure the parser in your ESLint configuration.

See the [installation guide, configuration exhibit, and rule documentation](https://atom.io.fyi/docs/eslint-plugin). When migrating from `atom.io/eslint-plugin`, change the import to `@atom.io/eslint-plugin`; the default plugin export, named `Rules` export, rule names, and options are unchanged.
