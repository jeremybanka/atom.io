import type { UserConfig } from "tsdown"
import { defineConfig } from "tsdown"

// Build separately after the main entries: shared declaration chunks otherwise
// pull Socket.IO and child-process types into the Workers consumer surface.
const config: UserConfig = defineConfig({
	entry: { index: `src/server/cloudflare/index.ts` },
	outDir: `dist/server/cloudflare`,
	clean: true,
	dts: { sourcemap: true },
	deps: { neverBundle: [/^node:/, /^atom\.io(?:\/|$)/, /^@atom\.io\//] },
	fixedExtension: false,
	format: `esm`,
	platform: `neutral`,
})
export default config
