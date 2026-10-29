import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { extname, resolve } from "node:path"
import { chromium } from "playwright"
import { check } from "../__tests__/browser.check.mjs"

const directory = resolve(import.meta.dirname, `../__tests__/astro/dist`)
const server = createServer(async (request, response) => {
	const pathname = decodeURIComponent(
		new URL(request.url, `http://localhost`).pathname,
	)
	const file = resolve(
		directory,
		`.${pathname === `/` ? `/index.html` : pathname}`,
	)
	if (!file.startsWith(`${directory}/`)) {
		response.writeHead(403).end()
		return
	}
	try {
		const data = await readFile(file)
		response.setHeader(
			`content-type`,
			{
				".html": `text/html`,
				".js": `application/javascript`,
				".css": `text/css`,
			}[extname(file)] ?? `application/octet-stream`,
		)
		response.end(data)
	} catch {
		response.writeHead(404).end()
	}
})
await new Promise((ready) => server.listen(0, `127.0.0.1`, ready))
let browser
try {
	browser = await chromium.launch()
	const page = await browser.newPage()
	console.log(await check(page, `http://127.0.0.1:${server.address().port}`))
} finally {
	await browser?.close()
	await new Promise((done) => server.close(done))
}
