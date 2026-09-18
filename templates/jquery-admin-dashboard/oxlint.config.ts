import { defineConfig } from "oxlint"

export default defineConfig({
	ignorePatterns: [`dist/**`, `node_modules/**`],
	plugins: [`typescript`],
	options: { typeAware: true },
	rules: {
		"typescript/consistent-type-imports": `error`,
		"typescript/no-base-to-string": `error`,
		"typescript/no-floating-promises": `error`,
		"typescript/no-unnecessary-type-assertion": `error`,
	},
})
