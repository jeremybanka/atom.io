import { resolve } from "node:path"

import { storybookTest } from "@storybook/addon-vitest/vitest-plugin"
import { playwright } from "@vitest/browser-playwright"
import type { ViteUserConfig } from "vitest/config"
import { defineConfig } from "vitest/config"

/** Independent from unit-test environments and package coverage thresholds. */
const config: ViteUserConfig = defineConfig({
	plugins: [
		storybookTest({ configDir: resolve(import.meta.dirname, `.storybook`) }),
	],
	test: {
		name: `storybook`,
		// The addon disables API writes by default; traces/screenshots need them.
		api: { host: `127.0.0.1`, allowWrite: true },
		setupFiles: [`.storybook/vitest.setup.ts`],
		testTimeout: 30_000,
		coverage: { enabled: false },
		browser: {
			enabled: true,
			headless: true,
			provider: playwright({
				launchOptions: {
					chromiumSandbox: true,
					...(process.env[`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`]
						? {
								executablePath:
									process.env[`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`],
							}
						: {}),
				},
			}),
			instances: [
				{ browser: `chromium`, viewport: { width: 1440, height: 900 } },
			],
			screenshotFailures: true,
			trace: {
				mode: `retain-on-failure`,
				tracesDir: resolve(
					import.meta.dirname,
					`../../.scratch/storybook-tests/traces`,
				),
			},
			screenshotDirectory: resolve(
				import.meta.dirname,
				`../../.scratch/storybook-tests/screenshots`,
			),
		},
	},
})

export default config
