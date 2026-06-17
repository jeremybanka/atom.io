import type { UserConfig } from "vite"

import {
	defineAtomIoVitestConfig,
	publicCoverageSource,
	publicTestSuite,
} from "./__scripts__/vitest-config"

const publicCoverageConfig: UserConfig = defineAtomIoVitestConfig({
	name: `public-coverage`,
	test: {
		include: publicTestSuite,
		coverage: {
			include: publicCoverageSource,
		},
	},
})

export default publicCoverageConfig
