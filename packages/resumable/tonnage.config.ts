import { defineConfig, type TonnageConfig } from "tonnage"

const config: TonnageConfig = defineConfig({
	heading: `Browser serving sizes`,
	platform: `browser`,
	includePeers: true,
	exports: false,
	recipes: [
		{ name: `Resumable browser defaults`, entry: `tonnage-recipes/defaults.ts` },
		{
			name: `Atom family defaults including atom.io`,
			entry: `tonnage-recipes/atoms.ts`,
		},
	],
})
export default config
