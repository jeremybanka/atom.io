import type { UserConfig } from "tsdown"
import { defineConfig } from "tsdown"

const config: UserConfig = defineConfig({
	entry: {
		"core/index": `src/core/index.ts`,
		"client/index": `src/client/index.ts`,
		"server/index": `src/server/index.ts`,
		"react/index": `src/react/index.ts`,
		"react/lexical/index": `src/react/lexical/index.ts`,
		"testing/headless/index": `src/testing/headless/index.ts`,
		"testing/react/index": `src/testing/react/index.ts`,
	},
	clean: true,
	dts: { sourcemap: true },
	deps: { neverBundle: [/^node:/, /^atom\.io(?:\/|$)/, /^@atom\.io\//] },
	fixedExtension: false,
	format: `esm`,
	platform: `neutral`,
})
export default config
