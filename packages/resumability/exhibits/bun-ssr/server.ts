import resumability from "resumability/bun"
import { collect, serialize } from "resumability/server"

import { readCount } from "./count.ts"

const {
	outputs: [client],
} = await Bun.build({
	entrypoints: [`${import.meta.dir}/client.ts`],
	target: `browser`,
	plugins: [resumability],
})

const server = Bun.serve({
	hostname: `127.0.0.1`,
	port: 0,
	routes: {
		"/client.js": new Response(client, {
			headers: { "content-type": `text/javascript` },
		}),
		async "/"(request) {
			const { value, payload } = await collect(readCount, {
				signal: request.signal,
			})
			return new Response(
				`<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8">
		<title>Bun SSR resumption</title>
	</head>
	<body>
		<main id="app">
			<p>Server rendered: <output id="server-count">${value}</output></p>
			<p>Browser read: <output id="browser-count"></output></p>
			<button type="button">Read again</button>
			<script type="application/json" data-resumable>${serialize(payload)}</script>
		</main>
		<script type="module" src="/client.js"></script>
	</body>
</html>`,
				{ headers: { "content-type": `text/html; charset=utf-8` } },
			)
		},
	},
})

console.log(server.url.href)
