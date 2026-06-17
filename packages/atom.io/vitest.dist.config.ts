import type * as Vite from "vite"

import { defineOurVitestConfig } from "./__scripts__/define-our-vitest-config.ts"

const builtCodeConfig: Vite.UserConfig = defineOurVitestConfig({
	name: `built-code`,
	target: `dist`,
})

export default builtCodeConfig
