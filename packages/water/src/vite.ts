import type { Plugin } from "vite"

import { compile } from "./compiler.ts"

export interface WaterPluginOptions {
	include?: RegExp
}
export default function water(options: WaterPluginOptions = {}): Plugin {
	const include = options.include ?? /\.[jt]sx$/
	const matches = (id: string): boolean => {
		include.lastIndex = 0
		return !id.includes(`/node_modules/`) && include.test(id.split(`?`)[0])
	}
	return {
		name: `water`,
		enforce: `pre`,
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
