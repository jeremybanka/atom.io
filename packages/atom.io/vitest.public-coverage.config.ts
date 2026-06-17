import type { UserConfig } from "vite"
import { defineConfig } from "vitest/config"

import vitestConfig from "./vitest.config"

const publicTestSuite = [`__tests__/public/**/*.test.{ts,tsx}`]

const publicCoverageSource = [
	`src/main/**/*.{ts,tsx}`,
	`src/foundations/**/*.{ts,tsx}`,
	`src/react/**/*.{ts,tsx}`,
	`src/transceivers/**/*.{ts,tsx}`,
	`src/web/**/*.{ts,tsx}`,
]

const baseTestConfig = vitestConfig.test ?? {}
const baseCoverageConfig = baseTestConfig.coverage ?? {}

const publicCoverageConfig: UserConfig = defineConfig({
	...vitestConfig,
	test: {
		...baseTestConfig,
		name: `public-coverage`,
		include: publicTestSuite,
		coverage: {
			...baseCoverageConfig,
			include: publicCoverageSource,
		},
	},
})

export default publicCoverageConfig
