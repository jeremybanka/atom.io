import type { MiddlewareHandler } from "astro"

import { failPreparation } from "./astro-context.ts"
import { requestApplication } from "./astro-request.ts"

/** Keep request resources alive until the streamed response is finished. */
export const onRequest: MiddlewareHandler = async ({ request }, next) => {
	const { application } = requestApplication(request)
	try {
		const response = await next()
		if (!response.body) {
			application.dispose()
			return response
		}
		const reader = response.body.getReader()
		const body = new ReadableStream<Uint8Array>({
			async pull(controller) {
				try {
					const result = await reader.read()
					if (result.done) {
						application.dispose()
						controller.close()
					} else controller.enqueue(result.value)
				} catch (error) {
					try {
						failPreparation(error, application.dispose)
					} catch (failure) {
						controller.error(failure)
					}
				}
			},
			async cancel(reason) {
				try {
					await reader.cancel(reason)
				} finally {
					application.dispose()
				}
			},
		})
		return new Response(body, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
		})
	} catch (error) {
		return failPreparation(error, application.dispose)
	}
}
