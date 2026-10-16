import type { ViteUserConfig } from "vitest/config"
import { defineConfig } from "vitest/config"

const config: ViteUserConfig = defineConfig({
	test: {
		environment: `node`,
		globals: true,
		maxWorkers: 2,
	},
})

export default config
