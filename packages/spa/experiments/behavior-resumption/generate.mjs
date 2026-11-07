import fs from "node:fs/promises"
import { gzipSync } from "node:zlib"
import { render as spa } from "./build/spa.mjs"
import { render as islands } from "./build/islands.mjs"
import { render as spike } from "./build/spike.mjs"
import { render as qwik } from "./build-qwik/entry.ssr.js"
import { label } from "./common.ts"

const loader = await fs.readFile("build/loader.js", "utf8")
const css =
	"body{margin:24px;font:16px system-ui;color:#232b29}header{max-width:700px}section{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}article{padding:12px;background:#f1f3ee;border:1px solid #ddd}h2{font-size:18px}button{font:inherit;padding:8px}.spacer{height:1400px;background:#fcfcfa;padding:20px}"
const cases = [12, 200, 1000].map((count) => ({
	name: `store-${count}`,
	count,
	work: 0,
	precomputed: false,
	below: false,
}))
cases.push({
	name: "setup-200",
	count: 200,
	work: 200000,
	precomputed: false,
	below: false,
})
cases.push({
	name: "seeded-12",
	count: 12,
	work: 0,
	precomputed: false,
	below: false,
	initialQuantity: 7,
	initialCart: 11,
})
let sizes = []
for (const c of cases) {
	const props = {
		...c,
		...(c.precomputed
			? { labels: Array.from({ length: c.count }, (_, i) => label(i, c.work)) }
			: {}),
	}
	for (const variant of [
		"spa-eager",
		"spa-preload",
		"spa-islands",
		"resume-cold",
		"resume-preload",
		"qwik-default",
	]) {
		if (c.name.startsWith("seeded") && !variant.startsWith("resume")) continue
		let body,
			head = "",
			setups
		if (variant.startsWith("resume")) {
			const rendered = spike(props)
			body = `<div id="app">${rendered.html}</div>`
			setups = rendered.setups
			head = `<script>${loader}</script>`
			if (variant === "resume-preload")
				head += '<link rel="modulepreload" href="/resume/cart.js">'
		} else if (variant === "qwik-default") {
			body = (await qwik(props, true)).html
		} else {
			const perCard = variant === "spa-islands"
			const src = perCard ? "/spa-islands/client.js" : "/spa/client.js"
			body = `<div id="app">${perCard ? islands(props) : spa(props)}</div><script type="application/json" id="props">${JSON.stringify(props)}</script><script type="module">import{activate}from'${src}';activate();</script>`
			if (variant === "spa-preload")
				head += `<link rel="modulepreload" href="${src}">`
		}
		const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Store benchmark</title><style>${css}</style>${head}</head><body>${body}</body></html>`
		await fs.writeFile(`dist/${variant}-${c.name}.html`, html)
		sizes.push({
			variant,
			case: c.name,
			htmlBytes: Buffer.byteLength(html),
			htmlGzipBytes: gzipSync(html, { level: 6 }).length,
			serverSetups: setups,
		})
	}
}
await fs.cp("dist/qwik/assets", "dist/assets", { recursive: true })
for (const file of [
	"resume/cart.js",
	"spa/client.js",
	"spa-islands/client.js",
]) {
	const code = await fs.readFile(`dist/${file}`)
	sizes.push({
		file,
		bytes: code.length,
		gzipBytes: gzipSync(code, { level: 6 }).length,
	})
}
sizes.push({
	file: "inline-loader",
	bytes: Buffer.byteLength(loader),
	gzipBytes: gzipSync(loader, { level: 6 }).length,
})
await fs.writeFile("sizes.json", JSON.stringify(sizes, null, 2))
console.log("Generated pages and size manifest")
