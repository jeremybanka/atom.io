import { type BundleSizeConfig, defineConfig } from "@atom.io/bundle-size"

// @exhibit-region start config
const config: BundleSizeConfig = defineConfig({
	exports: {
		exclude: [`./package.json`],
	},
	marker: `my-package`,
	recipes: [
		{
			entry: `examples/recipes/react-app.ts`,
			name: `React app`,
			platform: `browser`,
		},
	],
})

export default config
// @exhibit-region end config
