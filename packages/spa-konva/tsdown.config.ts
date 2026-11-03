import { defineConfig } from "tsdown"

export default defineConfig({
	entry: [`src/index.ts`],
	format: `esm`,
	fixedExtension: false,
	dts: true,
	deps: {
		neverBundle: [/^@atom\.io\/spa(?:\/|$)/, /^atom\.io(?:\/|$)/, `konva`],
	},
})
