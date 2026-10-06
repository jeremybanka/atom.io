import {
	defineOurVitestConfig,
	PATHS_PUBLIC_TESTS,
} from "./__scripts__/define-our-vitest-config.ts"

export default defineOurVitestConfig({
	name: `public-source`,
	target: `src`,
	test: { include: [...PATHS_PUBLIC_TESTS], passWithNoTests: false },
})
