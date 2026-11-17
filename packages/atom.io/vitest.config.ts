import type * as Vite from "vite"
import { defineConfig } from "vitest/config"

import { defineOurVitestConfig } from "./__scripts__/define-our-vitest-config.ts"
import storybookTestConfig from "./vitest.storybook.config.ts"

const devConfig: Vite.UserConfig = defineOurVitestConfig({
	name: `dev`,
	target: `src`,
})

// The addon discovers the storybookTest project here for its testing widget.
// CI unit/coverage scripts continue to use their existing explicit configurations.
const config: Vite.UserConfig = defineConfig({
	test: { projects: [devConfig, storybookTestConfig] },
})
export default config
