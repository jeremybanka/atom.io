import type { ViteUserConfig } from "vitest/config"
import { mergeConfig } from "vitest/config"

import config from "./vitest.public.config.ts"

const coverageConfig: ViteUserConfig = mergeConfig(config, {
	test: {
		// Type-aware rules initialize a TypeScript project under coverage instrumentation.
		testTimeout: 10_000,
		coverage: {
			include: [`src/**/*.ts`],
			reporter: [`text`, `lcov`, `html`, `json`],
		},
	},
})

export default coverageConfig
