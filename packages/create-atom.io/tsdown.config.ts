import type { InlineConfig, UserConfig } from "tsdown"
import { defineConfig } from "tsdown"

const config: UserConfig = defineConfig({
	entry: {
		"create-atom.x": `src/create-atom.x.ts`,
		"create-atom.bin": `bin/create-atom.bin.ts`,
	},

	clean: true,
	dts: false,
	fixedExtension: false,
	format: `esm`,
	outDir: `dist`,
	platform: `node`,
	sourcemap: true,
	treeshake: true,
	tsconfig: `tsconfig.json`,
} satisfies InlineConfig)

export default config
