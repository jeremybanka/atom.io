import { afterEach, describe, expect, it, vi } from "vitest"

import {
	browserResumption,
	captureElement,
	createResumption,
	currentResumption,
	resumable as browser,
} from "../src/astro-client.ts"
import { onRequest } from "../src/astro-middleware.ts"
import { requestResumption, resumableRenderer } from "../src/astro-server.ts"
import {
	createCollection,
	currentCollection,
	resumable,
	serialize,
} from "../src/server.ts"
import type { Payload } from "../src/types.ts"

const seed = (value: string, key = `value`): Payload => ({
	version: 1,
	values: [[key, [1, value]]],
})
const value = (text: string, key = `value`) => ({
	key,
	server: () => text,
	client: () => `client`,
})
const request = () => new Request(`https://example.test/`)
const middleware = (req: Request, next: () => Response | Promise<Response>) =>
	onRequest({ request: req } as any, () =>
		Promise.resolve(next()),
	) as Promise<Response>
const encoder = new TextEncoder()
const html = (text: string, headers = {}) =>
	new Response(text, {
		headers: { "content-type": `text/html;charset=utf-8`, ...headers },
	})
const pagePayload = (text: string) =>
	JSON.parse(text.match(/data-resumability-page>(.*?)<\/script>/s)![1])

afterEach(() => {
	browserResumption(document).dispose()
	document.body.innerHTML = ``
})

describe(`Astro browser host`, () => {
	it(`harvests plain page values and renderer seeds once without a state library`, () => {
		document.body.innerHTML = `<script data-resumability-page>${serialize(seed(`page`))}</script><div></div>`
		const island = document.querySelector(`div`)!
		island.setAttribute(`data-resumability`, serialize(seed(`island`, `other`)))
		const host = browserResumption(document)
		expect(browserResumption(document)).toBe(host)
		expect(browser(value(`server`))).toBe(`page`)
		expect(browser(value(`server`, `other`))).toBe(`island`)
		expect(browser(value(`server`))).toBe(`client`)
		island.setAttribute(`data-resumability`, serialize(seed(`new`, `new`)))
		expect(browser(value(`server`, `new`))).toBe(`new`)
		expect(browser(value(`server`, `other`))).toBe(`client`)
		host.run(
			() => {
				expect(currentResumption()).toBeDefined()
			},
			{ resume: false },
		)
	})
	it(`prefers explicit scopes and keeps private seeds out of the page scope`, () => {
		document.body.innerHTML = `<astro-resumption><script data-resumable>${serialize(seed(`explicit`))}</script><div></div></astro-resumption>`
		const element = document.querySelector(`div`)!
		element.setAttribute(`data-resumability-private`, ``)
		element.setAttribute(
			`data-resumability`,
			serialize(seed(`private`, `private`)),
		)
		const local = createResumption()
		captureElement(local, element)
		expect(local.run(() => browser(value(`server`)))).toBe(`explicit`)
		expect(browser(value(`server`, `private`), local)).toBe(`private`)
		expect(browser(value(`server`, `private`))).toBe(`client`)
		captureElement(local, document.createElement(`div`))
		local.dispose()
	})
	it(`preserves constants, rejects stale defaults after navigation, and ends with the page`, () => {
		document.body.innerHTML = `<script data-resumability-page>${serialize({ version: 1, values: [...seed(`constant`, `constant`).values, ...seed(`stale`).values] })}</script>`
		const host = browserResumption(document)
		const stop = host.resumeWhen(() => false)
		expect(host.canResume).toBe(false)
		stop()
		expect(host.canResume).toBe(true)
		document.dispatchEvent(new Event(`astro:before-swap`))
		expect(host.canResume).toBe(false)
		expect(host.run(() => browser(value(`server`)))).toBe(`client`)
		expect(browser({ key: `constant`, server: () => `server` })).toBe(`constant`)
		expect(browser({ key: `constant`, server: () => `server` })).toBe(`constant`)
		window.dispatchEvent(
			Object.assign(new Event(`pagehide`), { persisted: true }),
		)
		expect(browserResumption(document)).toBe(host)
		window.dispatchEvent(new PageTransitionEvent(`pagehide`))
		expect(() => host.read(value(`server`))).toThrow()
		host.dispose()
		expect(browserResumption(document)).not.toBe(host)
	})
	it(`supports a document without a window`, () => {
		const detached = document.implementation.createHTMLDocument()
		const host = browserResumption(detached)
		expect(host.read(value(`server`))).toBe(`client`)
		host.dispose()
	})
})

describe(`Astro renderer adapter`, () => {
	const renderer = (produce = () => resumable(value(`server`))) => ({
		name: `example`,
		check: () => Promise.resolve(true),
		async renderToStaticMarkup(this: unknown) {
			return { html: await produce(), attrs: { original: `yes` } }
		},
	})
	const render = (adapter: any, req?: Request, component = {}) =>
		adapter.renderToStaticMarkup.call(
			req ? { result: { request: req } } : {},
			component,
			{},
			{},
		)
	it(`shares a request across renderers, merges explicit scopes, and preserves attributes`, async () => {
		const req = request()
		const adapter = resumableRenderer(renderer())
		const first = await render(adapter, req)
		expect(first.attrs.original).toBe(`yes`)
		expect(JSON.parse(first.attrs[`data-resumability`])).toEqual(seed(`server`))
		const explicit = createCollection()
		const second = await explicit.run(() =>
			render(
				resumableRenderer(
					renderer(() => resumable(value(`other`, `other`))) as any,
				),
				req,
			),
		)
		expect(JSON.parse(second.attrs[`data-resumability`]).values).toHaveLength(2)
		expect(requestResumption(req)).toBe(requestResumption(req))
		// An overlapping explicit key cannot replace the request's earlier result.
		await explicit.run(() => resumable(value(`overlap`)))
		expect(requestResumption(req).snapshot()).toEqual({
			version: 1,
			values: [...seed(`server`).values, ...seed(`other`, `other`).values],
		})
		explicit.dispose()
		requestResumption(req).dispose()
	})
	it(`isolates components and standalone renders while respecting an explicit owner`, async () => {
		const req = request()
		const adapter = resumableRenderer(renderer(), { isolate: () => true })
		expect((await render(adapter, req)).attrs).toHaveProperty(
			`data-resumability-private`,
		)
		expect(requestResumption(req).snapshot().values).toEqual([])
		expect((await render(adapter)).html).toBe(`server`)
		const explicit = createCollection()
		await explicit.run(() => render(adapter, req))
		expect(explicit.signal.aborted).toBe(false)
		explicit.dispose()
		requestResumption(req).dispose()
	})
	it(`releases a standalone collector on success and failure`, async () => {
		let scope!: ReturnType<typeof createCollection>
		const adapter = resumableRenderer(
			renderer(() => {
				scope = currentCollection()!
				return resumable(value(`server`))
			}),
		)
		expect((await render(adapter)).html).toBe(`server`)
		expect(scope.signal.aborted).toBe(true)
		const failure = resumableRenderer(
			renderer(() => {
				scope = currentCollection()!
				throw Error(`render`)
			}),
		)
		await expect(render(failure)).rejects.toThrow(`render`)
		expect(scope.signal.aborted).toBe(true)
	})
})

describe(`Astro request middleware`, () => {
	it(`scopes concurrent frontmatter reads and includes the sidecar in cacheable HTML`, async () => {
		const responses = await Promise.all(
			[`first`, `second`].map(async (text) => {
				const req = request()
				const response = await middleware(req, async () => {
					expect(currentCollection()).toBe(requestResumption(req).collection)
					await Promise.resolve()
					const title = await resumable(value(text))
					return html(`<html><body><h1>${title}</h1></body></html>`, {
						"content-length": `42`,
						etag: `old`,
						"cache-control": `public,max-age=60`,
					})
				})
				expect(response.headers.get(`content-length`)).toBeNull()
				expect(response.headers.get(`etag`)).toBeNull()
				expect(response.headers.get(`cache-control`)).toBe(`public,max-age=60`)
				const output = await response.text()
				expect(output).toContain(`</script></body>`)
				expect(requestResumption(req).collection.signal.aborted).toBe(true)
				return pagePayload(output)
			}),
		)
		expect(responses).toEqual([seed(`first`), seed(`second`)])
	})
	it(`preserves streaming, arbitrary UTF-8 boundaries, and misleading body tags in raw content`, async () => {
		const req = request()
		let finish!: () => void
		const ready = new Promise<void>((resolve) => {
			finish = resolve
		})
		let part = 0
		const suffix = `<script>const x = "</body>"</script><!-- </body> --><template><span>nested</span></template><p>é🦊</p></body></html>`
		const source = new ReadableStream<Uint8Array>({
			async pull(controller) {
				if (part++ === 0) {
					controller.enqueue(encoder.encode(`<!doctype html><html><body>`))
					return
				}
				await ready
				await resumable(value(`stream`))
				// Separate every byte, including the multi-byte characters.
				for (const byte of encoder.encode(suffix))
					controller.enqueue(new Uint8Array([byte]))
				controller.close()
			},
		})
		const response = await middleware(
			req,
			() => new Response(source, { headers: { "content-type": `text/html` } }),
		)
		const reader = response.body!.getReader()
		const first = new TextDecoder().decode((await reader.read()).value)
		expect(first).toBe(`<!doctype html><html><body>`)
		finish()
		let output = first
		for (;;) {
			const item = await reader.read()
			if (item.done) break
			output += new TextDecoder().decode(item.value)
		}
		expect(
			output.replace(
				/<script type="application\/json" data-resumability-page>.*?<\/script>/s,
				``,
			),
		).toBe(`<!doctype html><html><body>${suffix}`)
		expect(pagePayload(output)).toEqual(seed(`stream`))
	})
	it.each([`<main>fragment</main>`, `<body><p>document</p>`, `plain text`])(
		`seeds HTML without an explicit body end: %s`,
		async (text) => {
			const output = await (
				await middleware(request(), async () => {
					await resumable(value(`seed`))
					return html(text)
				})
			).text()
			expect(output).toContain(`${text}<script`)
			expect(pagePayload(output)).toEqual(seed(`seed`))
		},
	)
	it(`does not append markup inside an unclosed raw element and leaves empty HTML alone`, async () => {
		expect(
			await (await middleware(request(), () => html(`<body></body>`))).text(),
		).toBe(`<body></body>`)
		expect(
			await (
				await middleware(request(), async () => {
					await resumable(value(`seed`))
					return html(`<script>const x = 1`)
				})
			).text(),
		).toBe(`<script>const x = 1`)
	})
	it(`flushes a truncated UTF-8 sequence at end of stream`, async () => {
		const response = await middleware(
			request(),
			() =>
				new Response(new Uint8Array([0xc3]), {
					headers: { "content-type": `text/html` },
				}),
		)
		expect(await response.text()).toBe(`�`)
	})
	it.each([
		{ contentType: `application/json` },
		{ contentType: `text/html`, encoding: `gzip` },
		{},
	])(
		`passes through other response bodies: %j`,
		async ({
			contentType,
			encoding,
		}: {
			contentType?: string
			encoding?: string
		}) => {
			const req = request()
			const headers: Record<string, string> = {
				"content-length": `4`,
				etag: `original`,
			}
			if (contentType) headers[`content-type`] = contentType
			if (encoding) headers[`content-encoding`] = encoding
			const response = await middleware(
				req,
				() =>
					new Response(encoder.encode(`data`), {
						headers,
						status: 201,
						statusText: `Created`,
					}),
			)
			expect(await response.text()).toBe(`data`)
			expect(response.status).toBe(201)
			expect(response.statusText).toBe(`Created`)
			expect(response.headers.get(`etag`)).toBe(`original`)
			expect(response.headers.get(`content-length`)).toBe(`4`)
			expect(requestResumption(req).collection.signal.aborted).toBe(true)
		},
	)
	it(`closes bodyless responses and propagates frontmatter errors`, async () => {
		const req = request()
		expect(
			(await middleware(req, () => new Response(null, { status: 204 }))).status,
		).toBe(204)
		expect(requestResumption(req).collection.signal.aborted).toBe(true)
		const failed = request()
		await expect(
			middleware(failed, () => {
				throw Error(`frontmatter`)
			}),
		).rejects.toThrow(`frontmatter`)
		expect(requestResumption(failed).collection.signal.aborted).toBe(true)
	})
	it.each([true, false])(
		`propagates stream errors and cancellation (HTML=%s)`,
		async (isHtml) => {
			const headers = isHtml ? { "content-type": `text/html` } : {}
			const req = request()
			const source = new ReadableStream<Uint8Array>({
				pull() {
					throw Error(`stream failure`)
				},
			})
			const response = await middleware(
				req,
				() => new Response(source, { headers }),
			)
			await expect(response.text()).rejects.toThrow(`stream failure`)
			expect(requestResumption(req).collection.signal.aborted).toBe(true)
			const cancelled = request()
			const cancel = vi.fn(() => {
				throw Error(`cancel failure`)
			})
			const pending = new ReadableStream<Uint8Array>({
				pull: () => new Promise(() => {}),
				cancel,
			})
			const reply = await middleware(
				cancelled,
				() => new Response(pending, { headers }),
			)
			await expect(reply.body!.cancel(`navigation`)).rejects.toThrow(
				`cancel failure`,
			)
			expect(cancel).toHaveBeenCalledWith(`navigation`)
			expect(requestResumption(cancelled).collection.signal.aborted).toBe(true)
		},
	)
	it.each([true, false])(
		`interrupts a stalled stream when its request aborts (HTML=%s)`,
		async (isHtml) => {
			const controller = new AbortController()
			const req = new Request(`https://example.test`, {
				signal: controller.signal,
			})
			const cancel = vi.fn()
			const source = new ReadableStream<Uint8Array>({
				pull: () => new Promise(() => {}),
				cancel,
			})
			const response = await middleware(
				req,
				() =>
					new Response(source, {
						headers: isHtml ? { "content-type": `text/html` } : {},
					}),
			)
			const pending = response.text()
			controller.abort(Error(`disconnected`))
			await expect(pending).rejects.toThrow(`disconnected`)
			expect(cancel).toHaveBeenCalled()
		},
	)
	it(`interrupts stalled frontmatter and rejects an already aborted request`, async () => {
		const controller = new AbortController()
		const req = new Request(`https://example.test`, {
			signal: controller.signal,
		})
		const result = middleware(req, () => new Promise(() => {}))
		controller.abort(Error(`disconnected`))
		await expect(result).rejects.toThrow(`disconnected`)
		await expect(
			middleware(
				new Request(`https://example.test`, { signal: controller.signal }),
				() => html(`unused`),
			),
		).rejects.toThrow(`disconnected`)
	})
})
