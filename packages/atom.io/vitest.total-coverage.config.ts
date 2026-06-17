import type * as Vite from "vite"

import {
	defineOurVitestConfig,
	PATHS_COMPLETE_SOURCE,
} from "./__scripts__/define-our-vitest-config"

const totalCoverageConfig: Vite.UserConfig = defineOurVitestConfig({
	name: `total-coverage`,
	target: `src`,
	test: {
		coverage: {
			include: [...PATHS_COMPLETE_SOURCE],
		},
	},
})

export default totalCoverageConfig
