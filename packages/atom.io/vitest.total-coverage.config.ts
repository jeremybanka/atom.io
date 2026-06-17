import type { UserConfig } from "vite"

import {
	defineAtomIoVitestConfig,
	totalCoverageSource,
} from "./__scripts__/vitest-config"

const totalCoverageConfig: UserConfig = defineAtomIoVitestConfig({
	name: `total-coverage`,
	test: {
		coverage: {
			include: totalCoverageSource,
		},
	},
})

export default totalCoverageConfig
