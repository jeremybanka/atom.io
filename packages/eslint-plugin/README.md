<div align="center">
	<img
		alt="atom.io logo"
		src="https://raw.githubusercontent.com/jeremybanka/atom.io/main/apps/atom.io.fyi/public/favicon.png"
		width="160"
		height="160"
	>
</div>

<h1 align="center">
	<code>@atom.io/eslint-plugin</code>
</h1>

<p align="center">
	<a
		aria-label="NPM version"
		href="https://www.npmjs.com/package/@atom.io/eslint-plugin"
	>
		<img
			alt="NPM Version"
			src="https://img.shields.io/npm/v/@atom.io/eslint-plugin?style=for-the-badge"
		>
	</a>
	<a
		aria-label="Dependencies 1"
		href="https://www.npmjs.com/package/@atom.io/eslint-plugin"
	>
		<img
			alt="Dependencies 1"
			src="https://img.shields.io/badge/dependencies-1-0?style=for-the-badge"
		>
	</a>
	<a aria-label="Coverage" href="https://recoverage.cloud/">
		<img
			alt="Coverage"
			src="https://img.shields.io/endpoint?url=https%3A%2F%2Frecoverage.cloud%2Fshields%2F665Gbgm4N5b47w7qpruIa%2Feslint-plugin"
		>
	</a>
	<a
		aria-label="Types"
		href="https://www.npmjs.com/package/@atom.io/eslint-plugin"
	>
		<img
			alt="Types"
			src="https://img.shields.io/npm/types/@atom.io/eslint-plugin?style=for-the-badge"
		>
	</a>
</p>

<h3 align="center">
	ESLint rules for atom.io state and transaction declarations.
</h3>

<h3 align="center">
	<a href="https://atom.io.fyi/docs/eslint-plugin">📖 Read the docs at atom.io.fyi</a>
</h3>

Install this package as a development dependency alongside ESLint 9 or 10, `@typescript-eslint/parser` 8, and a supported TypeScript compiler (4.8.4 through 6.0.x).

The TypeScript peer describes the compiler API used by ESLint. You can build with TypeScript 7 alongside it: the starter templates alias TypeScript 7 as `@typescript/native` for `tsc` and `@typescript/typescript6` as `typescript` for ESLint's compiler API and the separate `tsc6` command.

The `exact-catch-types` rule requires a TypeScript parser configured with type information. Configure the parser in your ESLint configuration.

See the [installation guide, configuration exhibit, and rule documentation](https://atom.io.fyi/docs/eslint-plugin). When migrating from `atom.io/eslint-plugin`, change the import to `@atom.io/eslint-plugin`; the default plugin export, named `Rules` export, rule names, and options are unchanged.
