import { defineConfig, type TonnageConfig } from "tonnage"

const config: TonnageConfig = defineConfig({
	heading: `Browser serving size including SPA and atom.io`,
	platform: `browser`,
	includePeers: true,
	// Font files are emitted static assets; this table measures JavaScript only.
	external: [`*.otf`],
	exports: false,
	recipes: [
		{
			name: `Interactive app with debugger`,
			entry: `tonnage-recipes/debugger.ts`,
		},
	],
})
export default config
