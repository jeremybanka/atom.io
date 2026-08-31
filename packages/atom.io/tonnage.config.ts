import { defineConfig, type TonnageConfig } from "tonnage"

const config: TonnageConfig = defineConfig({
	exports: {
		exclude: [`./react-devtools/css`],
	},
	external: [`@eslint/*`, `@typescript-eslint/*`, `eslint-*`],
	marker: `atom.io`,
	recipes: [
		{
			entry: `tonnage-recipes/core.ts`,
			name: `Core (for example, an LSP)`,
			platform: `node`,
		},
		{
			entry: `tonnage-recipes/react-app.ts`,
			name: `React app`,
			platform: `browser`,
		},
		{
			entry: `tonnage-recipes/realtime-react-client.ts`,
			name: `Realtime React client`,
			platform: `browser`,
		},
		{
			entry: `tonnage-recipes/realtime-server.ts`,
			name: `Realtime server`,
			platform: `node`,
		},
	],
})

export default config
