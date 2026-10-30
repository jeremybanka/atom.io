import type { UserConfig } from "tsdown"
import { defineConfig } from "tsdown"

const config: UserConfig = defineConfig({
	entry: [`src/index.ts`, `src/client.ts`, `src/server.ts`, `src/astro.ts`],
	clean: true,
	tsconfig: `tsconfig.build.json`,
	dts: { sourcemap: true },
	deps: { neverBundle: [/^node:/, /^@babel\//, /^astro(?:\/|$)/] },
	fixedExtension: false,
	format: `esm`,
	platform: `neutral`,
	target: `es2022`,
	sourcemap: true,
	copy: [`src/Resumption.astro`],
})
export default config
