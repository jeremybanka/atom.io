import type { ViteUserConfig } from "vitest/config"
import { mergeConfig } from "vitest/config"

import config from "./vitest.public.config.ts"

const coverageConfig: ViteUserConfig = mergeConfig(config, {
	test: {
		coverage: {
			include: [`src/**/*.ts`],
			reporter: [`text`, `lcov`, `html`, `json`],
		},
	},
})

export default coverageConfig
