// Bundled as a small classic inline head script, so input can be captured before
// the behavior module arrives. Only click on explicit non-submit buttons is in scope.
;(() => {
	const modules = new Map<
		string,
		Promise<Record<string, (element: Element) => unknown>>
	>()
	let queue = Promise.resolve()
	document.addEventListener(`click`, (event) => {
		const element =
			event.target instanceof Element
				? event.target.closest(`[data-resume-click]`)
				: null
		if (
			!(element instanceof HTMLButtonElement) ||
			element.disabled ||
			element.type !== `button`
		)
			return
		const address = element.getAttribute(`data-resume-click`) ?? ``
		const match = /^\/resume\/([a-z0-9-]+\.js)#([A-Za-z_$][\w$]*)$/.exec(address)
		if (!match) return
		const url = `/resume/${match[1]}`
		let loading = modules.get(url)
		if (!loading) {
			loading = import(url)
			modules.set(url, loading)
			// Handle rejection immediately even when an earlier click is still queued.
			loading.catch(() => modules.delete(url))
		}
		const module = loading
		queue = queue
			.then(async () => {
				const handler = (await module)[match[2]]
				if (typeof handler !== `function`)
					throw new Error(`resume: missing handler export`)
				// A host removed while its code was loading must not mutate detached state.
				if (element.isConnected) await handler(element)
			})
			.catch((error) => {
				// A failed event is not replayed automatically. Some browsers cache failed
				// imports even after our cache eviction, so recovery may require a reload.
				element.dispatchEvent(
					new CustomEvent(`resume-error`, {
						bubbles: true,
						detail: String(error),
					}),
				)
			})
	})
})()
