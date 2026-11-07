import fs from "node:fs/promises"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { build } from "esbuild"
import { compile } from "../../src/compiler.ts"

const root = path.resolve(import.meta.dirname, "../../../..")
const head = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
	encoding: "utf8",
}).trim()
const atom = path.join(root, "packages/atom.io/src")
const spa = path.join(root, "packages/spa/src")
const plugin = {
	name: "exact-pr-spa",
	setup(b) {
		b.onResolve({ filter: /^atom\.io(\/|$)/ }, (a) => ({
			path: path.join(
				atom,
				a.path === "atom.io" ? "main/index.ts" : a.path.slice(8) + "/index.ts",
			),
		}))
		b.onResolve({ filter: /^@atom\.io\/spa(\/|$)/ }, (a) => ({
			path: path.join(
				spa,
				a.path === "@atom.io/spa" ? "index.ts" : a.path.slice(13) + ".ts",
			),
		}))
		b.onLoad({ filter: /\.tsx$/ }, async (a) => ({
			contents: compile(await fs.readFile(a.path, "utf8"), a.path).code,
			loader: "ts",
			resolveDir: path.dirname(a.path),
		}))
	},
}
const shared = {
	bundle: true,
	format: "esm",
	target: "es2022",
	plugins: [plugin],
	define: {
		"import.meta.env.DEV": "false",
		"process.env.NODE_ENV": '"production"',
	},
	logLevel: "info",
}
await fs.mkdir("build", { recursive: true })
for (const [input, output, platform, minify] of [
	["spa/client.tsx", "dist/spa/client.js", "browser", true],
	["spa/server.tsx", "build/spa.mjs", "node", false],
	["spa-islands/client.tsx", "dist/spa-islands/client.js", "browser", true],
	["spa-islands/server.tsx", "build/islands.mjs", "node", false],
	["spike/server.tsx", "build/spike.mjs", "node", false],
	["spike/cart.ts", "dist/resume/cart.js", "browser", true],
]) {
	const result = await build({
		...shared,
		entryPoints: [input],
		outfile: output,
		platform,
		minify,
		metafile: true,
	})
	await fs.writeFile(
		`build/${path.basename(output)}.meta.json`,
		JSON.stringify(result.metafile, null, 2),
	)
}
await build({
	entryPoints: ["spike/loader.ts"],
	outfile: "build/loader.js",
	bundle: true,
	format: "iife",
	target: "es2022",
	minify: true,
})
console.log("Built checkout SPA baseline and isolated behavior spike:", head)
