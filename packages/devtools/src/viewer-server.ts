import { randomBytes } from "node:crypto"
import { readFile } from "node:fs/promises"
import { createServer, type Server, type ServerResponse } from "node:http"

export interface StandaloneDevtools {
	/** Local viewer URL. Keep this URL private because it grants access to the store. */
	url: URL
	close(): Promise<void>
}

interface ViewerRoutes {
	events?: (response: ServerResponse) => void
	socket?: (server: Server, url: URL) => () => void
}

const host = `127.0.0.1`

function viewerPage(useSocket: boolean): string {
	return [
		`<!doctype html>`,
		`<html lang="en">`,
		`<meta charset="utf-8">`,
		`<meta name="viewport" content="width=device-width, initial-scale=1">`,
		`<meta name="color-scheme" content="light dark">`,
		`<link rel="icon" href="data:,">`,
		`<title>Atom.io Devtools</title>`,
		`<link rel="stylesheet" href="./devtools.css">`,
		`<script type="module" src="./standalone-browser.js"></script>`,
		useSocket
			? `<body data-atom-io-devtools-page data-atom-io-devtools-socket></body>`
			: `<body data-atom-io-devtools-page></body>`,
		`</html>`,
	].join(`\n`)
}

function assetContentType(path: string): string | undefined {
	if (path === `devtools.css`) return `text/css; charset=utf-8`
	if (path === `standalone-browser.js`) return `text/javascript; charset=utf-8`
	if (/^fonts\/[\w.-]+\.otf$/.test(path)) return `font/otf`
	if (/^brand-fallback\/[\w.-]+\.webp$/.test(path)) return `image/webp`
}

/** Serve the browser assets and a private transport route on IPv4 loopback. */
export async function serveViewer(
	port: number | undefined,
	routes: ViewerRoutes,
): Promise<StandaloneDevtools> {
	const prefix = `/` + randomBytes(24).toString(`base64url`) + `/`
	const html = viewerPage(!!routes.socket)
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
		if (route === `events` && routes.events) {
			routes.events(response)
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
		server.listen(port ?? 0, host, () => {
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
	const closeSocket = routes.socket?.(server, url)
	let closing: Promise<void> | undefined

	return {
		url,
		close() {
			return (closing ??= new Promise<void>((resolve, reject) => {
				server.close((error) => {
					if (error) reject(error)
					else resolve()
				})
				closeSocket?.()
				server.closeAllConnections()
			}))
		},
	}
}
