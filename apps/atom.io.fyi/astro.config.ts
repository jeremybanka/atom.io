import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import cloudflare from "@astrojs/cloudflare"
import { unified } from "@astrojs/markdown-remark"
import mdx from "@astrojs/mdx"
import preact from "@astrojs/preact"
import { defineConfig, sessionDrivers } from "astro/config"

import { preserveCodeBlockCodeProps } from "./scripts/remark-codeblock-code-props.ts"

const CONFIG_ROOT = path.dirname(fileURLToPath(import.meta.url))
const EXHIBITS_ROOT = path.resolve(
	CONFIG_ROOT,
	`../../packages/atom.io/docs/source/exhibits`,
)
const VIRTUAL_EXHIBITS_MODULE_ID = `virtual:atom-io-exhibits`
const RESOLVED_VIRTUAL_EXHIBITS_MODULE_ID = `\0${VIRTUAL_EXHIBITS_MODULE_ID}`

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

function exhibitTextPlugin() {
	return {
		name: `atom-io-exhibit-text`,
		resolveId(id: string) {
			if (id === VIRTUAL_EXHIBITS_MODULE_ID) {
				return RESOLVED_VIRTUAL_EXHIBITS_MODULE_ID
			}
		},
		async load(id: string) {
			if (id !== RESOLVED_VIRTUAL_EXHIBITS_MODULE_ID) {
				return
			}
			const files = await listFiles(EXHIBITS_ROOT)
			const exhibits: Record<string, string> = {}
			for (const file of files) {
				const key = toPosixPath(path.relative(EXHIBITS_ROOT, file))
				exhibits[key] = await fs.readFile(file, `utf8`)
			}
			return `export const exhibits = ${JSON.stringify(exhibits)};`
		},
		configureServer(server: ViteDevServer) {
			server.watcher.add(EXHIBITS_ROOT)
		},
		handleHotUpdate(context: HmrContext) {
			const relativePath = path.relative(EXHIBITS_ROOT, context.file)
			if (relativePath.startsWith(`..`) || path.isAbsolute(relativePath)) {
				return
			}
			const exhibitModule = context.server.moduleGraph.getModuleById(
				RESOLVED_VIRTUAL_EXHIBITS_MODULE_ID,
			)
			if (exhibitModule) {
				context.server.moduleGraph.invalidateModule(exhibitModule)
			}
			context.server.ws.send({ type: `full-reload` })
			return []
		},
	}
}

// https://astro.build/config
export default defineConfig({
	integrations: [preact({ compat: true }), mdx()],
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
		plugins: [exhibitTextPlugin()],
	},
})
