import type * as Vite from "vite"

import {
	defineOurVitestConfig,
	PATHS_PUBLIC_TESTS,
} from "./__scripts__/define-our-vitest-config"

const publicCoverageConfig: Vite.UserConfig = defineOurVitestConfig({
	name: `public-built-code`,
	target: `dist`,
	test: {
		include: [...PATHS_PUBLIC_TESTS],
	},
})

export default publicCoverageConfig
