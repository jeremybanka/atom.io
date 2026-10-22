import type { ViteUserConfig } from "vitest/config"

import { defineOurVitestConfig } from "../../scripts/define-vitest-config.ts"

const config: ViteUserConfig = defineOurVitestConfig({
	name: `realtime-public`,
	target: `src`,
	test: {
		include: [`__tests__/public/**/*.test.{ts,tsx}`],
		passWithNoTests: false,
	},
})
export default config
