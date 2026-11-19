import type { UserConfig } from "tsdown"
import { defineConfig } from "tsdown"

import { compile } from "../spa/src/compiler.ts"

const config: UserConfig = defineConfig({
	entry: [`src/index.ts`, `src/react.ts`],
	clean: true,
	tsconfig: `tsconfig.build.json`,
	dts: { sourcemap: true },
	deps: {
		neverBundle: [
			/^atom\.io(?:\/|$)/,
			/^@atom\.io\//,
			/^react(?:\/|$)/,
			/^three(?:\/|$)/,
		],
	},
	fixedExtension: false,
	format: `esm`,
	platform: `neutral`,
	target: `es2022`,
	loader: { ".gif": `dataurl` },
	css: {
		fileName: `devtools.css`,
		splitting: false,
		inject: false,
		modules: { generateScopedName: `atom-io-[name]-[local]` },
		// The panel's container is shared by its separately owned child styles.
		lightningcss: { cssModules: { container: false } },
	},
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
