import type { UserConfig } from "tsdown"
import { defineConfig } from "tsdown"

const config: UserConfig = defineConfig({
	entry: [`src/index.ts`],
	clean: true,
	dts: true,
	deps: { neverBundle: [/^atom\.io(?:\/|$)/, /^@atom\.io\//] },
	fixedExtension: false,
	format: `esm`,
	platform: `neutral`,
})

export default config
