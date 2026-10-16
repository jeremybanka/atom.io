import type { UserConfig } from "tsdown"
import { defineConfig } from "tsdown"

const config: UserConfig = defineConfig({
	entry: [`src/index.ts`],
	clean: true,
	dts: true,
	fixedExtension: false,
	format: `esm`,
	platform: `node`,
})

export default config
