import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		include: [`__tests__/*.test.ts`],
		environment: `happy-dom`,
		maxWorkers: 2,
		coverage: {
			include: [`src/**/*.ts`],
			thresholds: { 100: true },
			reporter: [`text`, `lcov`, `html`, `json`, `json-summary`],
		},
	},
})
