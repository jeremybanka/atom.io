import type { ViteUserConfig } from "vitest/config"

import { defineOurVitestConfig } from "../../scripts/define-vitest-config.ts"

const config: ViteUserConfig = defineOurVitestConfig({
	name: `realtime-total-coverage`,
	target: `src`,
	test: {
		include: [`__tests__/{public,private}/**/*.test.{ts,tsx}`],
		coverage: { include: [`src/**/*.{ts,tsx}`] },
	},
})
export default config
