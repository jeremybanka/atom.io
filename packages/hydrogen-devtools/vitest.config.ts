import { resolve } from "node:path"

import { defineOurVitestConfig } from "../../scripts/define-vitest-config.ts"
import hydrogen from "../hydrogen/src/vite.ts"

const config = defineOurVitestConfig({
	name: `hydrogen-devtools`,
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
config.plugins = [hydrogen()]
config.resolve!.alias = [
	{
		find: /^@atom\.io\/hydrogen\/jsx(?:-dev)?-runtime$/,
		replacement: resolve(import.meta.dirname, `../hydrogen/src/jsx-runtime.ts`),
	},
	{
		find: /^@atom\.io\/hydrogen$/,
		replacement: resolve(import.meta.dirname, `../hydrogen/src/index.ts`),
	},
	...(config.resolve!.alias as any[]),
]
export default config
