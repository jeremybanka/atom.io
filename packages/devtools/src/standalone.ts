import { randomBytes } from "node:crypto"
import { readFile } from "node:fs/promises"
import { createServer, type ServerResponse } from "node:http"

import type { Silo } from "atom.io"

import { exposeDevtoolsStore } from "./remote.ts"
import { encodeStandaloneFrame } from "./standalone-wire.ts"

const host = `127.0.0.1`

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
	if (
		(silo.store.config.isProduction ||
			process.env[`NODE_ENV`] === `production`) &&
		options.productionAccess !== `inspect`
	) {
		throw new Error(
			`Standalone devtools requires explicit inspection access in production`,
		)
	}

	const prefix = `/` + randomBytes(24).toString(`base64url`) + `/`
	const streams = new Set<ServerResponse>()
	let authority: string

	const server = createServer((request, response) => {
		const path = request.url
		response.setHeader(`Cache-Control`, `no-store`)
		response.setHeader(`Referrer-Policy`, `no-referrer`)
		if (
			request.method !== `GET` ||
			request.headers.host !== authority ||
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
			response.writeHead(200, {
				"Content-Type": `text/event-stream; charset=utf-8`,
			})
			streams.add(response)
			response.once(`close`, () => streams.delete(response))
			try {
				exposeDevtoolsStore(
					{
						send(frame) {
							if (response.writableLength > 8 * 1024 * 1024) {
								throw new Error(`Standalone devtools client is too slow`)
							}
							response.write(`data: ` + encodeStandaloneFrame(frame) + `\n\n`)
						},
						listen(_receive, disconnected) {
							response.once(`close`, disconnected)
						},
						close: () => response.end(),
					},
					silo,
					{
						access: `inspect`,
						...(options.productionAccess
							? { productionAccess: options.productionAccess }
							: {}),
					},
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

	await new Promise<void>((ready, reject) => {
		server.once(`error`, reject)
		server.listen(options.port ?? 0, host, () => {
			server.off(`error`, reject)
			ready()
		})
	})
	const address = server.address()
	if (!address || typeof address === `string`)
		throw new Error(`Devtools listener has no TCP address`)
	authority = host + `:` + address.port
	const url = new URL(`http://` + authority + prefix)
	let closing: Promise<void> | undefined

	return {
		url,
		close() {
			return (closing ??= new Promise<void>((resolve, reject) => {
				for (const stream of streams) stream.end()
				server.close((error) => (error ? reject(error) : resolve()))
			}))
		},
	}
}
