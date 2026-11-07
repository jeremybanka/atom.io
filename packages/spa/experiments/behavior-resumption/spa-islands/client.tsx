import { hydrate } from "@atom.io/spa"

import { createApp } from "./app.tsx"

export function activate(): void {
	performance.mark(`hydrate-start`)
	const props = JSON.parse(document.querySelector(`#props`)!.textContent)
	const { store, Header, Card } = createApp(props)
	const roots = [
		hydrate(() => <Header />, document.querySelector(`#app header`)!, {
			store,
			idPrefix: `bench-header`,
		}),
	]
	const observer = new IntersectionObserver((entries) => {
		for (const entry of entries) {
			if (!entry.isIntersecting) continue
			observer.unobserve(entry.target)
			const id = Number((entry.target as HTMLElement).dataset[`island`])
			roots.push(
				hydrate(() => <Card id={id} />, entry.target, {
					store,
					idPrefix: `bench-card-${id}`,
				}),
			)
		}
	})
	for (const host of document.querySelectorAll(`#catalog article[data-island]`))
		observer.observe(host)
	window.addEventListener(
		`pagehide`,
		() => {
			observer.disconnect()
			for (const root of roots) root.dispose()
		},
		{ once: true },
	)
	performance.mark(`hydrate-end`)
	;(window as any).__ready = performance.now()
}
