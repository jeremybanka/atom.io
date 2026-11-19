import { readFile } from "node:fs/promises"

import type { BunPlugin } from "bun"

import { compile } from "./compiler.ts"

const resumability: BunPlugin = {
	name: `resumability`,
	setup(build) {
		if (!build.config || (build.config.target ?? `browser`) !== `browser`) return
		build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async ({ path, loader }) => {
			const source = await readFile(path, `utf8`)
			if (!source.includes(`resumability`)) return
			// Bun builds its source map from the stripped code. The Babel map would
			// embed the original server closures in the browser's sourcesContent.
			const { code } = compile(source, path, {
				jsx: loader === `jsx` || loader === `tsx`,
			})
			return { contents: code, loader }
		})
	},
}

export default resumability
