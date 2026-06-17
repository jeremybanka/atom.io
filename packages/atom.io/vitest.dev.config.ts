import type { UserConfig } from "vite"

import { defineAtomIoVitestConfig } from "./__scripts__/vitest-config"

const devModeConfig: UserConfig = defineAtomIoVitestConfig({
	name: `dev`,
})

export default devModeConfig
