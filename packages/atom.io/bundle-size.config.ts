import { type BundleSizeConfig, defineConfig } from "@atom.io/bundle-size"

const config: BundleSizeConfig = defineConfig({
	exports: {
		exclude: [`./react-devtools/css`],
	},
	external: [`@eslint/*`, `@typescript-eslint/*`, `eslint-*`],
	marker: `atom.io`,
	recipes: [
		{
			imports: [`atom.io`],
			name: `Core (for example, an LSP)`,
			platform: `node`,
		},
		{
			imports: [`atom.io`, `atom.io/react`],
			name: `React app`,
			platform: `browser`,
		},
		{
			imports: [
				`atom.io`,
				`atom.io/react`,
				`atom.io/realtime`,
				`atom.io/realtime-client`,
				`atom.io/realtime-react`,
			],
			name: `Realtime React app`,
			platform: `browser`,
		},
	],
})

export default config
