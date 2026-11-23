import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import cloudflare from "@astrojs/cloudflare"
import { unified } from "@astrojs/markdown-remark"
import mdx from "@astrojs/mdx"
import spa from "@atom.io/spa/astro"
import { transformAsync as transformSolid } from "@solidjs/compiler"
import { defineConfig, sessionDrivers } from "astro/config"
import { transform } from "esbuild"

import { findExhibitSandboxes } from "./scripts/exhibit-sandboxes.ts"
import { preserveCodeBlockCodeProps } from "./scripts/remark-codeblock-code-props.ts"

const CONFIG_ROOT = path.dirname(fileURLToPath(import.meta.url))
const EXHIBITS_ROOT = path.resolve(
	CONFIG_ROOT,
	`../../packages/atom.io/docs/source/exhibits`,
)
const EXHIBIT_ROOTS = [
	{ root: EXHIBITS_ROOT, prefix: `` },
	{
		root: path.resolve(
			CONFIG_ROOT,
			`../../packages/realtime/docs/source/exhibits`,
		),
		prefix: ``,
	},
	{
		root: path.resolve(CONFIG_ROOT, `../../packages/spa/exhibits`),
		prefix: `spa/exhibits/`,
	},
	{
		root: path.resolve(CONFIG_ROOT, `../../packages/devtools/exhibits`),
		prefix: `devtools/exhibits/`,
	},
	{
		root: path.resolve(CONFIG_ROOT, `../../templates/spa-astro-ssr/src`),
		prefix: `spa-astro-ssr/src/`,
	},
	{
		root: path.resolve(CONFIG_ROOT, `../../templates/spa-astro-ssr/exhibits`),
		prefix: `spa-astro-ssr/exhibits/`,
	},
]
const VIRTUAL_EXHIBITS_MODULE_ID = `virtual:atom-io-exhibits`
const VIRTUAL_SANDBOXES_MODULE_ID = `virtual:atom-io-exhibit-sandboxes`
const VIRTUAL_PREVIEWS_MODULE_ID = `virtual:atom-io-exhibit-previews`
const virtualExhibitModules = [
	VIRTUAL_EXHIBITS_MODULE_ID,
	VIRTUAL_SANDBOXES_MODULE_ID,
	VIRTUAL_PREVIEWS_MODULE_ID,
]

type ViteDevServer = {
	moduleGraph: {
		invalidateAll(): void
	}
	watcher: {
		add(file: string): void
		on(event: `add` | `unlink`, callback: (file: string) => void): void
	}
	ws: {
		send(message: { type: `full-reload` }): void
	}
}

type HmrContext = {
	file: string
	server: ViteDevServer
}

async function listFiles(directory: string): Promise<string[]> {
	const entries = await fs.readdir(directory, { withFileTypes: true })
	const files = await Promise.all(
		entries.map(async (entry) => {
			const entryPath = path.join(directory, entry.name)
			if (entry.isDirectory()) {
				return listFiles(entryPath)
			}
			return [entryPath]
		}),
	)
	return files.flat().sort()
}

function toPosixPath(filePath: string): string {
	return filePath.split(path.sep).join(`/`)
}

function isExhibitFile(file: string): boolean {
	return EXHIBIT_ROOTS.some(({ root }) => {
		const relative = path.relative(root, file)
		return (
			relative !== `..` &&
			!relative.startsWith(`..${path.sep}`) &&
			!path.isAbsolute(relative)
		)
	})
}

function exhibitsPlugin() {
	async function loadExhibits() {
		const files = (
			await Promise.all(
				EXHIBIT_ROOTS.map(async ({ root, prefix }) =>
					(await listFiles(root)).map((file) => ({ root, prefix, file })),
				),
			)
		).flat()
		return Promise.all(
			files.map(async ({ root, prefix, file }) => ({
				file,
				source: prefix + toPosixPath(path.relative(root, file)),
				code: await fs.readFile(file, `utf8`),
			})),
		)
	}
	const indexExhibits = async () => {
		const files = await loadExhibits()
		return { files, ...findExhibitSandboxes(files) }
	}
	let index: ReturnType<typeof indexExhibits> | undefined
	const readIndex = () => (index ??= indexExhibits())
	function invalidate({ file, server }: HmrContext) {
		if (!isExhibitFile(file)) return
		index = undefined
		// Eligibility can change the JSX transform for an unchanged dependency.
		server.moduleGraph.invalidateAll()
		server.ws.send({ type: `full-reload` })
		return []
	}
	return {
		name: `atom-io-exhibits`,
		resolveId(id: string) {
			if (virtualExhibitModules.includes(id)) return `\0${id}`
		},
		async load(id: string) {
			if (!virtualExhibitModules.some((module) => id === `\0${module}`)) return
			const { files, sandboxes } = await readIndex()
			if (id !== `\0${VIRTUAL_EXHIBITS_MODULE_ID}`) {
				const view =
					id === `\0${VIRTUAL_PREVIEWS_MODULE_ID}` ? `preview` : `ecology`
				const imports = sandboxes
					.filter((sandbox) => sandbox[view])
					.map(({ source, file, preview }) => {
						const load = `() => import(${JSON.stringify(toPosixPath(file))})`
						const entry =
							view === `preview`
								? `{ framework: ${JSON.stringify(preview)}, load: ${load} }`
								: load
						return `[${JSON.stringify(source)}, ${entry}]`
					})
				return `export const sandboxes = new Map([${imports.join(`,\n`)}]);`
			}
			const exhibits = Object.fromEntries(
				files.map(({ source, code }) => [source, code]),
			)
			return `export const exhibits = ${JSON.stringify(exhibits)};
				export const sandboxViews = ${JSON.stringify(
					Object.fromEntries(
						sandboxes.map(({ source, ecology, preview }) => [
							source,
							{ ecology, preview: preview !== null },
						]),
					),
				)};`
		},
		transform: {
			// Lower other frameworks' JSX before the site's SPA compiler sees it.
			order: `pre` as const,
			async handler(code: string, id: string) {
				if (!/\.tsx?$/.test(id) || !isExhibitFile(id)) return
				// The enclosing packages mark their modules side-effect free. The
				// exhibit's top-level reads and writes are the point of this import.
				const { jsxFrameworks } = await readIndex()
				const moduleSideEffects = `no-treeshake` as const
				const framework = jsxFrameworks.get(id)
				if (framework === `react`) {
					const result = await transform(code, {
						loader: `tsx`,
						jsx: `automatic`,
						jsxImportSource: `react`,
						sourcefile: id,
						sourcemap: true,
					})
					return { ...result, moduleSideEffects }
				}
				if (framework === `solid`) {
					const result = await transformSolid(code, {
						filename: id,
						generate: `dom`,
						sourceMap: true,
					})
					return { code: result.code, map: result.map, moduleSideEffects }
				}
				return { code, moduleSideEffects }
			},
		},
		configureServer(server: ViteDevServer) {
			for (const { root } of EXHIBIT_ROOTS) server.watcher.add(root)
			for (const event of [`add`, `unlink`] as const)
				server.watcher.on(event, (file) => {
					invalidate({ file, server })
				})
		},
		handleHotUpdate: invalidate,
	}
}

// https://astro.build/config
export default defineConfig({
	redirects: {
		"/docs/react-devtools": `/docs/devtools`,
		"/docs/spa-devtools": `/docs/devtools`,
		"/docs/hydrogen": `/docs/spa`,
		"/hydrogen-lab": `/spa-lab`,
	},
	integrations: [
		// React exhibits can resolve the workspace bindings from source.
		spa({ include: /^(?!.*\/packages\/react\/src\/).*\.[jt]sx$/ }),
		mdx(),
	],
	markdown: {
		processor: unified({ remarkPlugins: [preserveCodeBlockCodeProps] }),
	},
	adapter: cloudflare(),
	session: {
		// Keep session storage self-contained so Astro does not auto-provision
		// a Cloudflare KV namespace for preview deployments.
		driver: sessionDrivers.lruCache(),
	},
	server: {
		port: 4321,
		host: `0.0.0.0`,
		allowedHosts: [`eris.local`, `atom-io`],
	},
	vite: {
		resolve: {
			dedupe: [
				`atom.io`,
				`@atom.io/spa`,
				`react`,
				`react-dom`,
				`solid-js`,
				`@solidjs/web`,
			],
		},
		// The first Solid exhibit must not trigger a dependency reload that closes its tab.
		optimizeDeps: { include: [`@solidjs/web`, `solid-js`] },
		plugins: [exhibitsPlugin()],
		build: {
			// BrandMark's optional Three.js entry is ~512 KiB minified.
			chunkSizeWarningLimit: 550,
		},
	},
})
