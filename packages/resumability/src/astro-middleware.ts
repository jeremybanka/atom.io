import type { MiddlewareHandler } from "astro"
import { SAXParser } from "parse5-sax-parser"

import {
	type AstroRequestResumption,
	requestResumption,
} from "./astro-request.ts"
import { serialize } from "./server.ts"

/** Cancellation must also interrupt producers or streams that ignore their signal. */
async function run<T>(
	host: AstroRequestResumption,
	compute: () => T | Promise<T>,
): Promise<T> {
	const signal = host.collection.signal
	let abort!: () => void
	const aborted = new Promise<never>((_, reject) => {
		abort = () => {
			reject(signal.reason)
		}
		signal.addEventListener(`abort`, abort, { once: true })
	})
	try {
		return await Promise.race([aborted, host.collection.run(compute)])
	} finally {
		signal.removeEventListener(`abort`, abort)
	}
}

function fail(
	host: AstroRequestResumption,
	reader: ReadableStreamDefaultReader<Uint8Array>,
	error: unknown,
): void {
	host.dispose()
	// Cancellation is best effort; retain the original producer or stream error.
	void reader.cancel(error).catch(() => {})
}

/** Inject only at parsed HTML boundaries; keep incomplete tokens between chunks. */
function htmlStream(
	host: AstroRequestResumption,
	reader: ReadableStreamDefaultReader<Uint8Array>,
): ReadableStream<Uint8Array> {
	const parser = new SAXParser({ sourceCodeLocationInfo: true })
	parser.resume()
	const decoder = new TextDecoder(),
		encoder = new TextEncoder()
	let pending = ``,
		start = 0,
		safe = 0,
		injected = false,
		raw = false,
		templates = 0
	let insertion: { offset: number; html: string } | undefined
	const payload = () => {
		const data = host.snapshot()
		return data.values.length
			? `<script type="application/json" data-resumability-page>${serialize(data)}</script>`
			: ``
	}
	const mark = (token: {
		sourceCodeLocation?: { endOffset: number } | null
	}) => {
		safe = token.sourceCodeLocation!.endOffset
	}
	parser.on(`startTag`, (token) => {
		if (token.tagName === `template`) ++templates
		if (
			/^(script|style|textarea|title|xmp|iframe|noembed|noframes|plaintext)$/.test(
				token.tagName,
			)
		)
			raw = true
		mark(token)
	})
	parser.on(`endTag`, (token) => {
		if (token.tagName === `template`) --templates
		if (
			/^(script|style|textarea|title|xmp|iframe|noembed|noframes)$/.test(
				token.tagName,
			)
		)
			raw = false
		if (token.tagName === `body` && templates === 0 && !injected) {
			insertion = {
				offset: token.sourceCodeLocation!.startOffset,
				html: payload(),
			}
			injected = true
		}
		mark(token)
	})
	for (const event of [`text`, `comment`, `doctype`] as const)
		parser.on(event, mark)
	const flush = (end: number) => {
		const count = end - start
		let text = pending.slice(0, count)
		if (insertion && insertion.offset >= start && insertion.offset <= end) {
			const index = insertion.offset - start
			text = text.slice(0, index) + insertion.html + text.slice(index)
			insertion = undefined
		}
		pending = pending.slice(count)
		start = end
		return text
	}
	return new ReadableStream({
		async pull(controller) {
			try {
				for (;;) {
					const result = await run(host, () => reader.read())
					if (result.done) {
						const tail = decoder.decode()
						pending += tail
						if (tail) parser.write(tail)
						parser.end()
						let text = flush(start + pending.length)
						if (!injected && !raw) text += payload()
						if (text) controller.enqueue(encoder.encode(text))
						host.dispose()
						controller.close()
						return
					}
					const text = decoder.decode(result.value, { stream: true })
					pending += text
					parser.write(text)
					const output = flush(safe)
					if (output) {
						controller.enqueue(encoder.encode(output))
						return
					}
				}
			} catch (error) {
				fail(host, reader, error)
				controller.error(error)
			}
		},
		async cancel(reason) {
			try {
				await reader.cancel(reason)
			} finally {
				host.dispose()
			}
		},
	})
}

export const onRequest: MiddlewareHandler = async ({ request }, next) => {
	const host = requestResumption(request)
	try {
		const response = await run(host, next)
		if (!response.body) {
			host.dispose()
			return response
		}
		const reader = response.body.getReader()
		const html =
			/^text\/html(?:;|$)/i.test(response.headers.get(`content-type`) ?? ``) &&
			!response.headers.has(`content-encoding`)
		const headers = new Headers(response.headers)
		let body: ReadableStream<Uint8Array>
		if (html) {
			headers.delete(`content-length`)
			headers.delete(`etag`)
			body = htmlStream(host, reader)
		} else
			body = new ReadableStream({
				async pull(controller) {
					try {
						const part = await run(host, () => reader.read())
						if (part.done) {
							host.dispose()
							controller.close()
						} else controller.enqueue(part.value)
					} catch (error) {
						fail(host, reader, error)
						controller.error(error)
					}
				},
				async cancel(reason) {
					try {
						await reader.cancel(reason)
					} finally {
						host.dispose()
					}
				},
			})
		return new Response(body, {
			status: response.status,
			statusText: response.statusText,
			headers,
		})
	} catch (error) {
		host.dispose()
		throw error
	}
}
