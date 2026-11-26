import { resolve } from "node:path"

import { configDefaults } from "vitest/config"

import { defineOurVitestConfig } from "../../scripts/define-vitest-config.ts"
import spa from "../spa/src/vite.ts"

const config = defineOurVitestConfig({
	name: `devtools`,
	target: `src`,
	test: {
		setupFiles: [`__tests__/setup.ts`],
		coverage: {
			thresholds: { 100: true },
			reporter: [`text`, `lcov`, `html`, `json`, `json-summary`],
		},
	},
})
config.root = import.meta.dirname
config.plugins = [spa({ include: /\/(?:devtools|spa)\/.*\.tsx$/ })]
const socketsTest = `__tests__/standalone-remote.test.ts`
config.test!.projects = [
	{
		extends: true,
		test: {
			name: `devtools`,
			include: [`__tests__/**/*.test.{ts,tsx}`],
			exclude: [...configDefaults.exclude, socketsTest],
		},
	},
	{
		extends: true,
		test: {
			name: `devtools-sockets`,
			include: [socketsTest],
			environment: `node`,
			pool: `forks`,
		},
	},
]
config.resolve!.alias = [
	{
		find: /^@atom\.io\/spa\/brand$/,
		replacement: resolve(import.meta.dirname, `../spa/src/brand.ts`),
	},
	{
		find: /^@atom\.io\/spa\/(three|renderer|motion)$/,
		replacement: resolve(import.meta.dirname, `../spa/src/$1.ts`),
	},
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
