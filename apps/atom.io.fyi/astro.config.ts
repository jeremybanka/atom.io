import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import cloudflare from "@astrojs/cloudflare"
import { unified } from "@astrojs/markdown-remark"
import mdx from "@astrojs/mdx"
import spa from "@atom.io/spa/astro"
import { defineConfig, sessionDrivers } from "astro/config"

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
const virtualExhibitModules = [
	VIRTUAL_EXHIBITS_MODULE_ID,
	VIRTUAL_SANDBOXES_MODULE_ID,
]

type ViteDevServer = {
	moduleGraph: {
		getModuleById(id: string): unknown
		invalidateModule(module: unknown): void
	}
	watcher: {
		add(file: string): void
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
	return {
		name: `atom-io-exhibits`,
		resolveId(id: string) {
			if (virtualExhibitModules.includes(id)) return `\0${id}`
		},
		async load(id: string) {
			if (!virtualExhibitModules.some((module) => id === `\0${module}`)) return
			const files = await loadExhibits()
			const sandboxes = findExhibitSandboxes(files)
			if (id === `\0${VIRTUAL_SANDBOXES_MODULE_ID}`) {
				const imports = sandboxes.map(
					({ source, file }) =>
						`[${JSON.stringify(source)}, () => import(${JSON.stringify(toPosixPath(file))})]`,
				)
				return `export const sandboxes = new Map([${imports.join(`,\n`)}]);`
			}
			const exhibits = Object.fromEntries(
				files.map(({ source, code }) => [source, code]),
			)
			return `export const exhibits = ${JSON.stringify(exhibits)};
				export const sandboxSources = new Set(${JSON.stringify(sandboxes.map(({ source }) => source))});`
		},
		transform(code: string, id: string) {
			if (/\.tsx?$/.test(id) && isExhibitFile(id)) {
				// The enclosing packages mark their modules side-effect free. The
				// exhibit's top-level reads and writes are the point of this import.
				return { code, moduleSideEffects: `no-treeshake` as const }
			}
		},
		configureServer(server: ViteDevServer) {
			for (const { root } of EXHIBIT_ROOTS) server.watcher.add(root)
		},
		handleHotUpdate(context: HmrContext) {
			if (!isExhibitFile(context.file)) return
			for (const id of virtualExhibitModules) {
				const exhibitModule = context.server.moduleGraph.getModuleById(`\0${id}`)
				if (exhibitModule)
					context.server.moduleGraph.invalidateModule(exhibitModule)
			}
			context.server.ws.send({ type: `full-reload` })
			return []
		},
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
	integrations: [spa(), mdx()],
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
		resolve: { dedupe: [`atom.io`, `@atom.io/spa`] },
		plugins: [exhibitsPlugin()],
		build: {
			// BrandMark's optional Three.js entry is ~512 KiB minified.
			chunkSizeWarningLimit: 550,
		},
	},
})
