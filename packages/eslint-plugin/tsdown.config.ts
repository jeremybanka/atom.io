import { defineConfig, type UserConfig } from "tsdown"

const config: UserConfig = defineConfig({
	entry: [`src/index.ts`],
	clean: true,
	dts: true,
	fixedExtension: false,
	format: `esm`,
	platform: `node`,
	deps: {
		onlyImport: [
			`@typescript-eslint/types`,
			`@typescript-eslint/utils`,
			`eslint`,
		],
	},
})

export default config
