import { defineConfig } from "@playwright/test"

const FRONTEND_PORT = 5_527
const executablePath = process.env.MOSAIC_PLAYWRIGHT_EXECUTABLE_PATH

export default defineConfig({
	fullyParallel: false,
	outputDir: `test-results/browser`,
	reporter: process.env.CI ? [[`github`], [`list`]] : `list`,
	retries: 0,
	testDir: `tests/browser`,
	timeout: 60_000,
	use: {
		baseURL: `http://127.0.0.1:${FRONTEND_PORT}`,
		launchOptions:
			executablePath === undefined
				? {}
				: {
						executablePath,
					},
		screenshot: `only-on-failure`,
		trace: `retain-on-failure`,
		video: `retain-on-failure`,
	},
	webServer: [
		{
			command: `pnpm exec vite --mode browser-conformance --host 127.0.0.1 --port ${FRONTEND_PORT} --strictPort`,
			reuseExistingServer: false,
			timeout: 30_000,
			url: `http://127.0.0.1:${FRONTEND_PORT}`,
		},
	],
	workers: 1,
})
