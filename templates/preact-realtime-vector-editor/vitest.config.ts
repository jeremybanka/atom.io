import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		environment: `happy-dom`,
		globals: true,
		include: [`tests/**/*.test.tsx`],
		testTimeout: 15_000,
	},
})
