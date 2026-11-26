import { resolve } from "node:path"

import { build } from "esbuild"
import type { UserConfig } from "tsdown"
import { defineConfig } from "tsdown"

import { compile } from "../spa/src/compiler.ts"

const config: UserConfig = defineConfig({
	entry: {
		index: `src/index.ts`,
		ecology: `src/ecology-entry.ts`,
		react: `src/react.ts`,
		cli: `src/cli.ts`,
		standalone: `src/standalone.ts`,
		remote: `src/remote.ts`,
		worker: `src/worker.ts`,
	},
	clean: true,
	tsconfig: `tsconfig.build.json`,
	dts: { sourcemap: true },
	deps: {
		neverBundle: [
			/^node:/,
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
	loader: { ".png": `dataurl` },
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
	hooks: {
		async "build:done"({ options }) {
			await build({
				entryPoints: [`src/standalone-browser.ts`],
				outfile: resolve(options.outDir, `standalone-browser.js`),
				alias: { "@atom.io/devtools": resolve(options.outDir, `index.js`) },
				bundle: true,
				format: `esm`,
				platform: `browser`,
				target: `es2022`,
				minify: true,
				legalComments: `eof`,
				tsconfigRaw: {},
				define: { "import.meta.env.DEV": `false` },
			})
		},
	},
	copy: [
		`src/css.d.ts`,
		{ from: `src/fonts/*`, to: `dist/fonts` },
		// globals.css bundles SPA's brand stylesheet with its relative URLs.
		`node_modules/@atom.io/spa/dist/brand-fallback`,
	],
})
export default config
