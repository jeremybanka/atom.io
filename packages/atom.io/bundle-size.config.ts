import { type BundleSizeConfig, defineConfig } from "@atom.io/bundle-size"

const config: BundleSizeConfig = defineConfig({
	exports: {
		exclude: [`./react-devtools/css`],
	},
	external: [`@eslint/*`, `@typescript-eslint/*`, `eslint-*`],
	marker: `atom.io`,
	recipes: [
		{
			entry: `bundle-size-recipes/core.ts`,
			name: `Core (for example, an LSP)`,
			platform: `node`,
		},
		{
			entry: `bundle-size-recipes/react-app.ts`,
			name: `React app`,
			platform: `browser`,
		},
		{
			entry: `bundle-size-recipes/realtime-react-client.ts`,
			name: `Realtime React client`,
			platform: `browser`,
		},
		{
			entry: `bundle-size-recipes/realtime-server.ts`,
			name: `Realtime server`,
			platform: `node`,
		},
	],
})

export default config
