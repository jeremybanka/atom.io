import type { UserConfig } from "tsdown"
import { defineConfig } from "tsdown"

import { compile } from "./src/compiler.ts"

const config: UserConfig[] = defineConfig(
	[false, true].map((development): UserConfig => ({
		entry: [
			`src/index.ts`,
			`src/renderer.ts`,
			`src/konva.ts`,
			`src/three.ts`,
			`src/brand.ts`,
			`src/brand-model.ts`,
			`src/motion.ts`,
			`src/floating.ts`,
			`src/jsx-runtime.ts`,
			`src/server.ts`,
			`src/vite.ts`,
			`src/hot.ts`,
			`src/astro.ts`,
			`src/astro-client.ts`,
			`src/astro-server.ts`,
			`src/astro-resumability-client.ts`,
			`src/astro-resumability-server.ts`,
			`src/astro-application.ts`,
			`src/astro-middleware.ts`,
		],
		outDir: development ? `dist/development` : `dist`,
		clean: true,
		tsconfig: `tsconfig.build.json`,
		dts: development ? false : { sourcemap: true },
		deps: {
			neverBundle: [
				/^node:/,
				/^@atom\.io\/spa\/jsx-runtime$/,
				/^atom\.io(?:\/|$)/,
				/^oxc-parser$/,
				/^astro(?:\/|$)/,
				/^resumability(?:\/|$)/,
				/^vite(?:\/|$)/,
				/^konva(?:\/|$)/,
				/^three(?:\/|$)/,
				/^motion(?:\/|$)/,
				/^@floating-ui\/dom$/,
			],
		},
		fixedExtension: false,
		format: `esm`,
		platform: `neutral`,
		target: `es2022`,
		sourcemap: true,
		define: { "import.meta.env.DEV": String(development) },
		css: {
			fileName: `brand.css`,
			splitting: false,
			inject: false,
			modules: { generateScopedName: `atom-io-spa-[name]-[local]` },
		},
		plugins: [
			{
				name: `spa-components`,
				transform: {
					filter: { id: /\.tsx$/ },
					handler(code, id) {
						return compile(code, id)
					},
				},
			},
		],
		copy: [`src/brand-fallback`, ...(development ? [] : [`src/brand-css.d.ts`])],
	})),
)
export default config
