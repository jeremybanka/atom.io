import type { UserConfig } from "tsdown"
import { defineConfig } from "tsdown"

import { compile } from "../spa/src/compiler.ts"

const config: UserConfig = defineConfig({
	entry: [`src/index.ts`],
	clean: true,
	tsconfig: `tsconfig.build.json`,
	dts: { sourcemap: true },
	deps: { neverBundle: [/^atom\.io(?:\/|$)/, /^@atom\.io\//] },
	fixedExtension: false,
	format: `esm`,
	platform: `neutral`,
	target: `es2022`,
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
	copy: [`src/devtools.css`, `src/css.d.ts`],
})
export default config
