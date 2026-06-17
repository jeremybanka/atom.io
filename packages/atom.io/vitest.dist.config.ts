import type { UserConfig } from "vite"

import { defineAtomIoVitestConfig } from "./__scripts__/vitest-config.ts"

const builtCodeConfig: UserConfig = defineAtomIoVitestConfig({
	name: `built-code`,
	testDist: true,
})

export default builtCodeConfig
