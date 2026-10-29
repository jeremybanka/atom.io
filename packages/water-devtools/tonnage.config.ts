import { defineConfig, type TonnageConfig } from "tonnage"

const config: TonnageConfig = defineConfig({
	exports: { include: [`.`] },
	platform: `browser`,
})
export default config
