import type { UserConfig } from "tsdown"
import { defineConfig } from "tsdown"

const config: UserConfig[] = defineConfig(
	[false, true].map((development): UserConfig => ({
		entry: [
			`src/index.ts`,
			`src/jsx-runtime.ts`,
			`src/server.ts`,
			`src/vite.ts`,
			`src/astro.ts`,
			`src/astro-client.ts`,
			`src/astro-server.ts`,
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
				/^atom\.io(?:\/|$)/,
				/^@babel\//,
				/^astro(?:\/|$)/,
				/^vite(?:\/|$)/,
			],
		},
		fixedExtension: false,
		format: `esm`,
		platform: `neutral`,
		target: `es2022`,
		sourcemap: true,
		define: { "import.meta.env.DEV": String(development) },
	})),
)
export default config
