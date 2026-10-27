import reylo from "reylo/vite"
import type { ViteUserConfig } from "vitest/config"
import { defaultExclude } from "vitest/config"

import type { OurVitestConfigOptions } from "../../../scripts/define-vitest-config.ts"
import { defineOurVitestConfig as defineSharedConfig } from "../../../scripts/define-vitest-config.ts"

export * from "../../../scripts/define-vitest-config.ts"

export function defineOurVitestConfig(
	options: OurVitestConfigOptions,
): ViteUserConfig {
	const config = defineSharedConfig(options)
	// postgres.js buffers cross VM realms, but Reylo checks Uint8Array identity.
	// Keep database tests in normal workers and other tests in the shared VM pool.
	const postgresTests = `__tests__/private/experiments/stateless/**/*.test.ts`
	return {
		...config,
		plugins: [reylo()],
		test: {
			...config.test,
			...(options.test?.include
				? {}
				: {
						projects: [
							{
								extends: true,
								test: {
									name: options.name,
									exclude: [...defaultExclude, postgresTests],
								},
							},
							{
								extends: true,
								test: {
									name: `${options.name}-postgres`,
									include: [postgresTests],
									pool: `threads`,
									environment: `node`,
								},
							},
						],
					}),
		},
	}
}
