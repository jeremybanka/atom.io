import { defineConfig, type TonnageConfig } from "tonnage"

const config: TonnageConfig = defineConfig({
	heading: `Browser serving sizes including atom.io`,
	platform: `browser`,
	includePeers: true,
	exports: false,
	recipes: [
		{
			name: `Family app with refs and history`,
			entry: `tonnage-recipes/family-app.ts`,
		},
		{
			name: `Async interactive client app`,
			entry: `tonnage-recipes/async-app.ts`,
		},
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
