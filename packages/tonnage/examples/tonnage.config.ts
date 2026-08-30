import { defineConfig, type TonnageConfig } from "tonnage"

// @exhibit-region start config
const config: TonnageConfig = defineConfig({
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
