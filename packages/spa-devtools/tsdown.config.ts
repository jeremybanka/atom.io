import type { UserConfig } from "tsdown"
import { defineConfig } from "tsdown"

import { compile } from "../spa/src/compiler.ts"

const config: UserConfig = defineConfig({
	entry: [`src/index.ts`, `src/react.ts`],
	clean: true,
	tsconfig: `tsconfig.build.json`,
	dts: { sourcemap: true },
	deps: { neverBundle: [/^atom\.io(?:\/|$)/, /^@atom\.io\//, /^react(?:\/|$)/] },
	fixedExtension: false,
	format: `esm`,
	platform: `neutral`,
	target: `es2022`,
	css: { fileName: `devtools.css`, splitting: false, inject: false },
	sourcemap: true,
	plugins: [
		{
			name: `spa`,
			transform: {
				filter: { id: /\.tsx$/ },
				handler(code, id) {
					return compile(code, id)
				},
			},
		},
	],
	copy: [`src/css.d.ts`, { from: `src/fonts/*`, to: `dist/fonts` }],
})
export default config
