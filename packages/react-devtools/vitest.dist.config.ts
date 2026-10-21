import type { ViteUserConfig } from "vitest/config"

import { defineOurVitestConfig } from "../../scripts/define-vitest-config.ts"

const config: ViteUserConfig = defineOurVitestConfig({
	name: `react-devtools-built`,
	target: `dist`,
	test: { include: [`__tests__/{public,private}/**/*.test.{ts,tsx}`] },
})
export default config
