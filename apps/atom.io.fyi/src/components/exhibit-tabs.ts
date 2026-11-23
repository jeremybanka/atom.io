export function selectExhibitTab(tab: HTMLButtonElement): void {
	if (tab.getAttribute(`aria-selected`) === `true`) return
	const exhibit = tab.closest<HTMLElement>(`code-block[data-exhibit-source]`)!
	const source = exhibit.dataset[`exhibitSource`]!
	for (const sibling of exhibit.querySelectorAll<HTMLButtonElement>(
		`[role="tab"]`,
	)) {
		const selected = sibling === tab
		sibling.setAttribute(`aria-selected`, String(selected))
		sibling.tabIndex = selected ? 0 : -1
		const panel = document.getElementById(
			sibling.getAttribute(`aria-controls`)!,
		)!
		panel.hidden = !selected
		const view = panel.dataset[`exhibitPanel`]
		if (view) {
			if (selected) {
				const frame = document.createElement(`iframe`)
				const title = view === `ecology` ? `State ecology` : `Component preview`
				frame.title = `${title} of ${source.split(`/`).at(-1)}`
				frame.sandbox.add(`allow-scripts`)
				// Vite serves unbundled modules from the development origin.
				if (import.meta.env.DEV) frame.sandbox.add(`allow-same-origin`)
				frame.src = `/exhibit-${view}#${encodeURIComponent(source)}`
				panel.append(frame)
			} else {
				panel.replaceChildren()
			}
		}
	}
}

export function handleExhibitTabKey(event: KeyboardEvent): void {
	const target = event.target
	if (!(target instanceof HTMLButtonElement)) return
	const tabs = target.closest(`code-block[data-exhibit-source] [role="tablist"]`)
	if (!tabs) return
	const buttons = [...tabs.querySelectorAll<HTMLButtonElement>(`[role="tab"]`)]
	const index = buttons.indexOf(target)
	let next: number
	if (event.key === `ArrowLeft`)
		next = (index + buttons.length - 1) % buttons.length
	else if (event.key === `ArrowRight`) next = (index + 1) % buttons.length
	else if (event.key === `Home`) next = 0
	else if (event.key === `End`) next = buttons.length - 1
	else return
	event.preventDefault()
	const tab = buttons[next]
	selectExhibitTab(tab)
	tab.focus()
}
