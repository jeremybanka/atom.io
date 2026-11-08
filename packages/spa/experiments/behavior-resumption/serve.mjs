import http from "node:http"
import fs from "node:fs/promises"
import path from "node:path"
import { gzipSync } from "node:zlib"
const cache = new Map()
export const server = http
	.createServer(async (req, res) => {
		try {
			const name = new URL(req.url, "http://localhost").pathname
			const file = path.resolve("dist", "." + name)
			if (!file.startsWith(path.resolve("dist") + "/"))
				throw new Error("Invalid path")
			let body = cache.get(file)
			if (!body) {
				body = gzipSync(await fs.readFile(file), { level: 6 })
				cache.set(file, body)
			}
			res.writeHead(200, {
				"content-type": file.endsWith(".js")
					? "text/javascript"
					: file.endsWith(".json")
						? "application/json"
						: "text/html",
				"content-encoding": "gzip",
				"content-length": body.length,
				"cache-control": "public, max-age=3600",
			})
			res.end(body)
		} catch {
			res.writeHead(404)
			res.end("not found")
		}
	})
	.listen(4174, "127.0.0.1", () => {
		console.log("http://127.0.0.1:4174")
	})
