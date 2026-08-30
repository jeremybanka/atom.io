import { type BundleSizeConfig, defineConfig } from "@atom.io/bundle-size"

// @exhibit-region start config
const config: BundleSizeConfig = defineConfig({
	exports: {
		exclude: [`./package.json`],
	},
	marker: `my-package`,
	recipes: [
		{
			imports: [`my-package`, `my-package/react`],
			name: `React app`,
			platform: `browser`,
		},
	],
})

export default config
// @exhibit-region end config
