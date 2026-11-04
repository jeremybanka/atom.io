import type { ViteUserConfig } from "vitest/config"
import { mergeConfig } from "vitest/config"

import config from "./vitest.public.config.ts"

const coverageConfig: ViteUserConfig = mergeConfig(config, {
	test: {
		// Cold TypeScript project setup competes with other package suites under CI coverage.
		testTimeout: 30_000,
		coverage: {
			include: [`src/**/*.ts`],
			reporter: [`text`, `lcov`, `html`, `json`],
		},
	},
})

export default coverageConfig
