import { fileURLToPath } from "node:url"

import type { ViteUserConfig } from "vitest/config"
import { mergeConfig } from "vitest/config"

import config from "./vitest.config.ts"

const publicConfig: ViteUserConfig = mergeConfig(config, {
	resolve: {
		alias: [
			{
				find: /^@atom\.io\/eslint-plugin$/,
				replacement: fileURLToPath(new URL(`./src/index.ts`, import.meta.url)),
			},
		],
	},
	test: {
		include: [`__tests__/rules/**/*.test.ts`],
		passWithNoTests: false,
	},
})

export default publicConfig
