import { resolve } from "node:path"

import { defineOurVitestConfig } from "../../scripts/define-vitest-config.ts"
import water from "./src/vite.ts"

const config = defineOurVitestConfig({
	name: `water`,
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
config.plugins = [water()]
config.resolve!.alias = [
	{
		find: /^@atom\.io\/water\/jsx(?:-dev)?-runtime$/,
		replacement: resolve(import.meta.dirname, `src/jsx-runtime.ts`),
	},
	{
		find: /^@atom\.io\/water$/,
		replacement: resolve(import.meta.dirname, `src/index.ts`),
	},
	...(config.resolve!.alias as any[]),
]
export default config
