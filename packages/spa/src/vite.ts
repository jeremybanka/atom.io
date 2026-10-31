import type { Plugin } from "vite"

import { compile } from "./compiler.ts"

export interface SpaPluginOptions {
	include?: RegExp
}
export default function spa(options: SpaPluginOptions = {}): Plugin {
	const include = options.include ?? /\.[jt]sx$/
	const matches = (id: string): boolean => {
		include.lastIndex = 0
		return !id.includes(`/node_modules/`) && include.test(id.split(`?`)[0])
	}
	return {
		name: `spa`,
		enforce: `pre`,
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
		transform(code, id) {
			if (!matches(id)) return
			return compile(code, id)
		},
		// A reload disposes the whole document. No state-preserving HMR is promised.
		handleHotUpdate({ server, file }) {
			if (matches(file)) {
				server.ws.send({ type: `full-reload` })
				return []
			}
		},
	}
}
