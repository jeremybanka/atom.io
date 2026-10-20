import { resolve } from "node:path"

import type { TestUserConfig, ViteUserConfig } from "vitest/config"
import { defineConfig } from "vitest/config"

type CoverageOptions = NonNullable<TestUserConfig[`coverage`]>

export type OurVitestConfigOptions = {
	name: string
	target: `dist` | `src`
	test?: Partial<TestUserConfig>
}

export const PATHS_COMPLETE_SOURCE = [`src/**/*.{ts,tsx}`] as const

export const PATHS_PUBLIC_TESTS = [
	`__tests__/public/**/*.test.{ts,tsx}`,
] as const

export const PATHS_PUBLIC_SOURCE = [
	`src/main/**/*.{ts,tsx}`,
	`src/foundations/**/*.{ts,tsx}`,
	`src/transceivers/**/*.{ts,tsx}`,
	`src/web/**/*.{ts,tsx}`,
] as const

const COVERAGE_CONFIG_BASE = {
	allowExternal: true,
	reporter: [`text`, `lcov`, `html`, `json`],
	include: [...PATHS_COMPLETE_SOURCE],
	exclude: [`__unstable__`],
} as const satisfies CoverageOptions

const SOURCE_ALIASES = [
	...([`react`, `solid`, `react-devtools`] as const).map((name) => ({
		find: new RegExp(`^@atom\\.io/${name}$`),
		replacement: resolve(import.meta.dirname, `../packages/${name}/src`),
	})),
	{
		find: /^atom\.io$/,
		replacement: resolve(import.meta.dirname, `../packages/atom.io/src/main`),
	},
	{
		find: /^atom\.io\/(.*)$/,
		replacement: resolve(import.meta.dirname, `../packages/atom.io/src/$1`),
	},
] as const satisfies NonNullable<ViteUserConfig[`resolve`]>[`alias`]

const TEST_CONFIG_BASE = {
	pool: `vmThreads`,
	maxWorkers: 2,
	globals: true,
	testTimeout: 10_000,
	environment: `happy-dom`,
	environmentOptions: {
		happyDOM: {
			settings: { fetch: { disableSameOriginPolicy: true } },
		},
	},
	coverage: COVERAGE_CONFIG_BASE,
} as const satisfies TestUserConfig

export function defineOurVitestConfig(
	options: OurVitestConfigOptions,
): ViteUserConfig {
	const testConfig = options.test ?? {}
	const coverageConfig = testConfig.coverage ?? {}

	let alias: NonNullable<ViteUserConfig[`resolve`]>[`alias`]
	switch (options.target) {
		case `dist`:
			alias = []
			break
		case `src`:
			alias = [...SOURCE_ALIASES]
			break
	}

	const config: ViteUserConfig = defineConfig({
		resolve: { alias },
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
