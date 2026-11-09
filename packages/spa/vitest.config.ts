import { resolve } from "node:path"

import { defineOurVitestConfig } from "../../scripts/define-vitest-config.ts"
import spa from "./src/vite.ts"

const config = defineOurVitestConfig({
	name: `spa`,
	target: `src`,
	test: {
		include: [`__tests__/**/*.test.{ts,tsx}`],
		coverage: {
			thresholds: { 100: true },
			reporter: [`text`, `lcov`, `html`, `json`, `json-summary`],
		},
	},
})
config.root = import.meta.dirname
config.plugins = [spa()]
config.resolve!.alias = [
	...[`floating`, `motion`, `three`, `konva`].map((name) => ({
		find: `@atom.io/spa/${name}`,
		replacement: resolve(import.meta.dirname, `src/${name}.ts`),
	})),
	{
		find: /^@atom\.io\/spa\/renderer$/,
		replacement: resolve(import.meta.dirname, `src/renderer.ts`),
	},
	{
		find: /^@atom\.io\/spa\/server$/,
		replacement: resolve(import.meta.dirname, `src/server.ts`),
	},
	{
		find: /^@atom\.io\/spa\/jsx(?:-dev)?-runtime$/,
		replacement: resolve(import.meta.dirname, `src/jsx-runtime.ts`),
	},
	{
		find: /^@atom\.io\/spa$/,
		replacement: resolve(import.meta.dirname, `src/index.ts`),
	},
	...(config.resolve!.alias as any[]),
]
export default config
