import type * as Vite from "vite"

import {
	defineOurVitestConfig,
	PATHS_PUBLIC_SOURCE,
	PATHS_PUBLIC_TESTS,
} from "./__scripts__/define-our-vitest-config"

const publicCoverageConfig: Vite.UserConfig = defineOurVitestConfig({
	name: `public-coverage`,
	target: `src`,
	test: {
		include: [...PATHS_PUBLIC_TESTS],
		coverage: {
			reportsDirectory: `coverage-public`,
			include: [...PATHS_PUBLIC_SOURCE],
			thresholds: { 100: true },
		},
	},
})

export default publicCoverageConfig
