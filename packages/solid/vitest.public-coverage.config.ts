import type { ViteUserConfig } from "vitest/config"

import { defineOurVitestConfig } from "../../scripts/define-vitest-config.ts"

const config: ViteUserConfig = defineOurVitestConfig({
	name: `solid-public-coverage`,
	target: `src`,
	test: {
		include: [`__tests__/public/**/*.test.{ts,tsx}`],
		coverage: {
			reportsDirectory: `coverage-public`,
			include: [`src/**/*.{ts,tsx}`],
			thresholds: { 100: true },
		},
	},
})
export default config
