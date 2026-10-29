import { defineConfig, type TonnageConfig } from "tonnage"

const config: TonnageConfig = defineConfig({
	heading: `Browser serving sizes including atom.io`,
	platform: `browser`,
	includePeers: true,
	exports: false,
	recipes: [
		{
			name: `Interactive client app`,
			entry: `tonnage-recipes/client-app.ts`,
		},
		{
			name: `Hydrated interactive app`,
			entry: `tonnage-recipes/hydrated-app.ts`,
		},
		{
			name: `Interactive Astro island`,
			entry: `tonnage-recipes/astro-island.ts`,
		},
	],
})
export default config
