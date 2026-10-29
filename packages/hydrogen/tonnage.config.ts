import { defineConfig, type TonnageConfig } from "tonnage"

const config: TonnageConfig = defineConfig({
	platform: `browser`,
	// Babel probes this optional preset via require.resolve; no preset code is imported.
	external: [`@babel/preset-typescript/package.json`],
	exports: {
		include: [`.`, `./jsx-runtime`, `./jsx-dev-runtime`, `./astro-client`],
	},
	recipes: [
		{
			name: `Complete client + JSX`,
			entry: `tonnage-recipes/client.ts`,
			platform: `browser`,
		},
		{
			name: `Server renderer`,
			entry: `tonnage-recipes/server.ts`,
			platform: `node`,
		},
		{
			name: `Vite compiler`,
			entry: `tonnage-recipes/vite.ts`,
			platform: `node`,
		},
		{
			name: `Astro integration`,
			entry: `tonnage-recipes/astro.ts`,
			platform: `node`,
		},
		{
			name: `Astro server renderer`,
			entry: `tonnage-recipes/astro-server.ts`,
			platform: `node`,
		},
	],
})
export default config
