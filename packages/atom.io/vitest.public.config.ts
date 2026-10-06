import type * as Vite from "vite"

import {
	defineOurVitestConfig,
	PATHS_PUBLIC_TESTS,
} from "./__scripts__/define-our-vitest-config.ts"

const publicSourceConfig: Vite.UserConfig = defineOurVitestConfig({
	name: `public-source`,
	target: `src`,
	test: { include: [...PATHS_PUBLIC_TESTS], passWithNoTests: false },
})

export default publicSourceConfig
