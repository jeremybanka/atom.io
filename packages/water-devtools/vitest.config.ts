import { resolve } from "node:path"

import { defineOurVitestConfig } from "../../scripts/define-vitest-config.ts"
import water from "../water/src/vite.ts"

const config = defineOurVitestConfig({
	name: `water-devtools`,
	target: `src`,
	test: { include: [`__tests__/**/*.test.{ts,tsx}`] },
})
config.root = import.meta.dirname
config.plugins = [water()]
config.resolve!.alias = [
	{
		find: /^@atom\.io\/water\/jsx(?:-dev)?-runtime$/,
		replacement: resolve(import.meta.dirname, `../water/src/jsx-runtime.ts`),
	},
	{
		find: /^@atom\.io\/water$/,
		replacement: resolve(import.meta.dirname, `../water/src/index.ts`),
	},
	...(config.resolve!.alias as any[]),
]
export default config
