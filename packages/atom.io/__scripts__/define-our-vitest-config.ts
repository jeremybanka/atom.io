import { cpus } from "node:os"
import { resolve } from "node:path"

import type * as Vite from "vite"
import type { TestUserConfig } from "vitest/config"
import { defineConfig } from "vitest/config"

type CoverageOptions = NonNullable<TestUserConfig[`coverage`]>

export type OurVitestConfigOptions = {
	name: string
	target: `dist` | `src`
	test?: Partial<TestUserConfig>
}

export const PATHS_COMPLETE_SOURCE = [`**/src`] as const

export const PATHS_PUBLIC_TESTS = [
	`__tests__/public/**/*.test.{ts,tsx}`,
] as const

export const PATHS_PUBLIC_SOURCE = [
	`src/main/**/*.{ts,tsx}`,
	`src/foundations/**/*.{ts,tsx}`,
	`src/react/**/*.{ts,tsx}`,
	`src/transceivers/**/*.{ts,tsx}`,
	`src/web/**/*.{ts,tsx}`,
] as const

const COVERAGE_CONFIG_BASE = {
	reporter: [`text`, `lcov`, `html`, `json`],
	include: [...PATHS_COMPLETE_SOURCE],
	exclude: [`__unstable__`],
} as const satisfies CoverageOptions

const SOURCE_ALIASES = [
	{
		find: /^atom\.io$/,
		replacement: resolve(__dirname, `../src/main`),
	},
	{
		find: /^atom\.io\/(.*)$/,
		replacement: resolve(__dirname, `../src/$1`),
	},
] as const satisfies Vite.Alias[]

const TEST_CONFIG_BASE = {
	pool: `vmThreads`,
	maxWorkers: cpus().length - 1,
	globals: true,
	testTimeout: 10_000,
	environment: `happy-dom`,
	coverage: COVERAGE_CONFIG_BASE,
} as const satisfies TestUserConfig

export function defineOurVitestConfig(
	options: OurVitestConfigOptions,
): Vite.UserConfig {
	const testConfig = options.test ?? {}
	const coverageConfig = testConfig.coverage ?? {}

	let alias: Vite.AliasOptions
	switch (options.target) {
		case `dist`:
			alias = []
			break
		case `src`:
			alias = [...SOURCE_ALIASES]
			break
	}

	const config: Vite.UserConfig = defineConfig({
		resolve: { alias },
		esbuild: { target: `es2022` },
		test: {
			...TEST_CONFIG_BASE,
			...testConfig,
			name: options.name,
			coverage: {
				...COVERAGE_CONFIG_BASE,
				...coverageConfig,
			},
		},
	})

	return config
}
