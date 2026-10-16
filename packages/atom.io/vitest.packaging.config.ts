import type { UserConfig } from "vite"
import { defineConfig } from "vitest/config"

const config: UserConfig = defineConfig({
	test: {
		name: `packaging`,
		include: [`__tests__/packaging/**/*.test.ts`],
		// Rolldown's native bindings need a process rather than a VM thread.
		pool: `forks`,
		environment: `node`,
		maxWorkers: 1,
		testTimeout: 180_000,
	},
})

export default config
