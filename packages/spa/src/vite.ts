import type { Plugin } from "vite"

import { compile } from "./compiler.ts"
import { hotModule, requiresModuleReload } from "./compiler-hmr.ts"

export interface SpaPluginOptions {
	include?: RegExp
}
export default function spa(options: SpaPluginOptions = {}): Plugin {
	const include = options.include ?? /\.[jt]sx$/
	let development = false
	const signatures = new Map<string, string>()
	const matches = (id: string): boolean => {
		include.lastIndex = 0
		return !id.includes(`/node_modules/`) && include.test(id.split(`?`)[0])
	}
	return {
		name: `spa`,
		enforce: `pre`,
		configResolved(config) {
			development = config.command === `serve` && config.mode !== `test`
		},
		config() {
			return {
				resolve: { dedupe: [`@atom.io/spa`, `atom.io`] },
				optimizeDeps: { exclude: [`@atom.io/spa`, `atom.io`] },
			}
		},
		configEnvironment: {
			order: `post`,
			handler(_name, config) {
				// Astro and its adapters force renderer entries into the optimizer.
				// Vite processes explicit includes even when their package is excluded.
				// Keep the renderer, hooks, and store in one unbundled module graph.
				if (config.optimizeDeps?.include) {
					config.optimizeDeps.include = config.optimizeDeps.include.filter(
						(id) => !/^(@atom\.io\/spa|atom\.io)(\/|$)/.test(id),
					)
				}
			},
		},
		transform(code, id, environment) {
			if (!matches(id)) return
			const compiled = compile(code, id)
			if (development && !environment?.ssr) {
				const key = id.split(`?`)[0]
				const hot = hotModule(compiled.code, id, compiled.map)
				if (hot) {
					signatures.set(key, hot.exports.join(`\0`))
					return { code: hot.code, map: hot.map }
				}
				if (id === key) signatures.delete(key)
			}
			return compiled
		},
		async handleHotUpdate({ server, file, read }) {
			if (matches(file)) {
				try {
					const compiled = compile(await read(), file)
					const hot = development
						? hotModule(compiled.code, file, compiled.map)
						: undefined
					if (hot && signatures.get(file) === hot.exports.join(`\0`)) return
				} catch (error) {
					server.ws.send({
						type: `error`,
						err: {
							message: String(error),
							stack: error instanceof Error ? (error.stack ?? ``) : ``,
							id: file,
						},
					})
					return []
				}
				server.ws.send({ type: `full-reload` })
				return []
			}
			if (
				!file.includes(`/node_modules/`) &&
				/\.[cm]?[jt]sx?$/.test(file) &&
				requiresModuleReload(await read(), file)
			) {
				server.ws.send({ type: `full-reload` })
				return []
			}
		},
	}
}
