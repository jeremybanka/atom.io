import { resolve } from "node:path"

import { defineOurVitestConfig } from "../../scripts/define-vitest-config.ts"
import spa from "../spa/src/vite.ts"

const config = defineOurVitestConfig({
	name: `spa-devtools`,
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
	{
		find: /^@atom\.io\/spa\/jsx(?:-dev)?-runtime$/,
		replacement: resolve(import.meta.dirname, `../spa/src/jsx-runtime.ts`),
	},
	{
		find: /^@atom\.io\/spa$/,
		replacement: resolve(import.meta.dirname, `../spa/src/index.ts`),
	},
	...(config.resolve!.alias as any[]),
]
export default config
