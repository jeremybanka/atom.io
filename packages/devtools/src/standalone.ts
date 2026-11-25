import { randomBytes } from "node:crypto"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"

import type { Silo } from "atom.io"

import { exposeWholeStore } from "./remote-store.ts"
import {
	encodeStandaloneFrame,
	prepareStandaloneValue,
} from "./standalone-wire.ts"

const host = `127.0.0.1`
const maxPendingUpdateBytes = 8 * 1024 * 1024

const html = [
	`<!doctype html>`,
	`<html lang="en">`,
	`<meta charset="utf-8">`,
	`<meta name="viewport" content="width=device-width, initial-scale=1">`,
	`<meta name="color-scheme" content="light dark">`,
	`<link rel="icon" href="data:,">`,
	`<title>Atom.io Devtools</title>`,
	`<link rel="stylesheet" href="./devtools.css">`,
	`<script type="module" src="./standalone-browser.js"></script>`,
	`<body data-atom-io-devtools-page></body>`,
	`</html>`,
].join(`\n`)

export interface StandaloneDevtoolsOptions {
	/** An ephemeral port is used when this is omitted or set to zero. */
	port?: number
	/** Explicitly permit inspection when the Silo or Node process is in production. */
	productionAccess?: `inspect`
}

export interface StandaloneDevtools {
	/** Local viewer URL. Keep this URL private because it grants access to the store. */
	url: URL
	close(): Promise<void>
}

function assetContentType(path: string): string | undefined {
	if (path === `devtools.css`) return `text/css; charset=utf-8`
	if (path === `standalone-browser.js`) return `text/javascript; charset=utf-8`
	if (/^fonts\/[\w.-]+\.otf$/.test(path)) return `font/otf`
	if (/^brand-fallback\/[\w.-]+\.webp$/.test(path)) return `image/webp`
}

/** Serve the browser viewer for an existing Silo over IPv4 loopback. */
export async function serveDevtoolsStore(
	silo: Silo,
	options: StandaloneDevtoolsOptions = {},
): Promise<StandaloneDevtools> {
	const canInspect = () =>
		options.productionAccess === `inspect` ||
		(!silo.store.config.isProduction && process.env[`NODE_ENV`] !== `production`)
	if (!canInspect()) {
		throw new Error(
			`Standalone devtools requires explicit inspection access in production`,
		)
	}

	const prefix = `/` + randomBytes(24).toString(`base64url`) + `/`
	let authority: string
	let boundAuthority: string

	const server = createServer((request, response) => {
		const path = request.url
		response.setHeader(`Cache-Control`, `no-store`)
		response.setHeader(`Referrer-Policy`, `no-referrer`)
		if (
			request.method !== `GET` ||
			(request.headers.host !== authority &&
				request.headers.host !== boundAuthority) ||
			!path?.startsWith(prefix)
		) {
			response.writeHead(404).end()
			return
		}

		const route = path.slice(prefix.length)
		if (route === ``) {
			response
				.writeHead(200, { "Content-Type": `text/html; charset=utf-8` })
				.end(html)
			return
		}
		if (route === `events`) {
			if (!canInspect()) {
				response.writeHead(404).end()
				return
			}
			response.writeHead(200, {
				"Content-Type": `text/event-stream; charset=utf-8`,
			})
			let pendingUpdateBytes = 0
			try {
				exposeWholeStore(
					{
						send(frame) {
							if (pendingUpdateBytes > maxPendingUpdateBytes) {
								response.destroy()
								throw new Error(`Standalone devtools client is too slow`)
							}
							const data = `data: ` + encodeStandaloneFrame(frame) + `\n\n`
							if (frame.type === `store`) {
								response.write(data)
								return
							}
							// A large initial snapshot can drain while updates queue behind it.
							const bytes = Buffer.byteLength(data)
							pendingUpdateBytes += bytes
							response.write(data, () => {
								pendingUpdateBytes -= bytes
							})
						},
						listen(_receive, disconnected) {
							response.once(`close`, disconnected)
						},
						close: () => response.end(),
					},
					silo,
					false,
					prepareStandaloneValue,
				)
			} catch {
				response.destroy()
			}
			return
		}

		const type = assetContentType(route)
		if (type) {
			void readFile(new URL(route, import.meta.url)).then(
				(body) => response.writeHead(200, { "Content-Type": type }).end(body),
				() => response.writeHead(404).end(),
			)
		} else {
			response.writeHead(404).end()
		}
	})

	const url = await new Promise<URL>((ready, reject) => {
		server.once(`error`, reject)
		server.listen(options.port ?? 0, host, () => {
			server.off(`error`, reject)
			const address = server.address()
			if (!address || typeof address === `string`) {
				server.close()
				reject(new Error(`Devtools listener has no TCP address`))
				return
			}
			boundAuthority = host + `:` + address.port
			const listeningUrl = new URL(`http://` + boundAuthority + prefix)
			authority = listeningUrl.host
			ready(listeningUrl)
		})
	})
	let closing: Promise<void> | undefined

	return {
		url,
		close() {
			return (closing ??= new Promise<void>((resolve, reject) => {
				server.close((error) => {
					if (error) reject(error)
					else resolve()
				})
				server.closeAllConnections()
			}))
		},
	}
}
