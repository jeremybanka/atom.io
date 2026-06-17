import type * as Vite from "vite"

import { defineOurVitestConfig } from "./__scripts__/define-our-vitest-config.ts"

const devConfig: Vite.UserConfig = defineOurVitestConfig({
	name: `dev`,
	target: `src`,
})

export default devConfig
