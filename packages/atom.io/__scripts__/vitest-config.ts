import { cpus } from "node:os"
import { resolve } from "node:path"

import type { UserConfig } from "vite"
import { defineConfig } from "vitest/config"

type TestConfig = NonNullable<UserConfig[`test`]>
type CoverageConfig = NonNullable<TestConfig[`coverage`]>

export type AtomIoVitestConfigOptions = {
	name: string
	testDist?: boolean
	test?: Partial<TestConfig>
}

export const totalCoverageSource: string[] = [`**/src`]

export const publicTestSuite: string[] = [`__tests__/public/**/*.test.{ts,tsx}`]

export const publicCoverageSource: string[] = [
	`src/main/**/*.{ts,tsx}`,
	`src/foundations/**/*.{ts,tsx}`,
	`src/react/**/*.{ts,tsx}`,
	`src/transceivers/**/*.{ts,tsx}`,
	`src/web/**/*.{ts,tsx}`,
]

const baseCoverageConfig: CoverageConfig = {
	reporter: [`text`, `lcov`, `html`, `json`],
	include: totalCoverageSource,
	exclude: [`__unstable__`],
}

const baseTestConfig: TestConfig = {
	pool: `vmThreads`,
	maxWorkers: cpus().length - 1,
	globals: true,
	testTimeout: 10_000,
	environment: `happy-dom`,
	coverage: baseCoverageConfig,
}

export function defineAtomIoVitestConfig(
	options: AtomIoVitestConfigOptions,
): UserConfig {
	const testConfig = options.test ?? {}
	const coverageConfig = testConfig.coverage ?? {}
	const atomIoAliases = options.testDist
		? []
		: [
				{
					find: /^atom\.io$/,
					replacement: resolve(__dirname, `../src/main`),
				},
				{
					find: /^atom\.io\/(.*)$/,
					replacement: resolve(__dirname, `../src/$1`),
				},
			]

	const vitestConfig: UserConfig = defineConfig({
		resolve: {
			alias: [
				...atomIoAliases,
				{
					find: `~`,
					replacement: resolve(__dirname, `../../..`),
				},
				...[
					`hamr/react-json-editor`,
					`hamr/react-id`,
					`hamr/react-elastic-input`,
					`hamr/react-error-boundary`,
				].map((find) => ({
					find,
					replacement: resolve(__dirname, `../src`),
				})),
			],
		},
		esbuild: {
			target: `es2022`,
		},
		test: {
			...baseTestConfig,
			...testConfig,
			name: options.name,
			coverage: {
				...baseCoverageConfig,
				...coverageConfig,
			},
		},
	})

	return vitestConfig
}
