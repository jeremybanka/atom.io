import {
	EXHIBIT_VIEW_MESSAGE,
	type ExhibitView,
	isExhibitView,
} from "./exhibit-view.ts"

type Tab = Exclude<ExhibitView, `both`>

function isLiveTab(value: unknown): value is Exclude<Tab, `code`> {
	return value === `ecology` || value === `preview`
}

function showView(frame: HTMLIFrameElement, view: ExhibitView): void {
	// Production frames have an opaque origin. Only the view name crosses frames.
	frame.contentWindow?.postMessage({ type: EXHIBIT_VIEW_MESSAGE, view }, `*`)
}

function syncExhibit(exhibit: HTMLElement, activate = false): void {
	const selection = exhibit.dataset[`exhibitView`]
	const selected = isLiveTab(selection) ? selection : `code`
	const tabs = [
		...exhibit.querySelectorAll<HTMLButtonElement>(`[data-exhibit-tab]`),
	]
	const code = exhibit.querySelector<HTMLElement>(`code-pane`)!
	const live = exhibit.querySelector<HTMLElement>(`[data-exhibit-panel]`)!
	const width = exhibit.getBoundingClientRect().width
	const split = width >= 1000
	const showBoth = split && width >= 1500 && tabs.length === 3
	const preferredLiveTab =
		exhibit.dataset[`exhibitLiveView`] ?? tabs[1]?.dataset[`exhibitTab`]
	const view = showBoth
		? `both`
		: split && selected === `code` && isLiveTab(preferredLiveTab)
			? preferredLiveTab
			: selected
	exhibit.dataset[`exhibitLayout`] = showBoth ? `three` : split ? `two` : `one`
	code.hidden = selected !== `code` && !split
	live.hidden = view === `code`

	const liveLabels: string[] = []
	for (const tab of tabs) {
		const name = tab.dataset[`exhibitTab`]
		const active = name === selected
		tab.setAttribute(`aria-selected`, String(active))
		tab.tabIndex = active ? 0 : -1
		const visible =
			name === `code` ? !code.hidden : name === view || view === `both`
		tab.toggleAttribute(`data-exhibit-visible`, visible)
		if (name !== `code` && visible) liveLabels.push(tab.id)
	}
	live.setAttribute(`aria-labelledby`, liveLabels.join(` `))

	const frame = live.querySelector(`iframe`)
	if (view === `code`) visibleExhibits.unobserve(exhibit)
	if (frame) {
		if (frame.dataset[`exhibitView`] !== view) {
			frame.dataset[`exhibitView`] = view
			showView(frame, view)
		}
	} else if (view !== `code` && activate) {
		visibleExhibits.unobserve(exhibit)
		const source = exhibit.dataset[`exhibitSource`]!
		const sandbox = document.createElement(`iframe`)
		sandbox.title = `Live exhibit for ${source.split(`/`).at(-1)}`
		sandbox.sandbox.add(`allow-scripts`)
		// Vite serves unbundled modules from the development origin.
		if (import.meta.env.DEV) sandbox.sandbox.add(`allow-same-origin`)
		sandbox.dataset[`exhibitView`] = view
		sandbox.addEventListener(`load`, () => {
			const current = sandbox.dataset[`exhibitView`]
			if (isExhibitView(current)) showView(sandbox, current)
		})
		sandbox.src = `/exhibit-sandbox?view=${view}#${encodeURIComponent(source)}`
		live.append(sandbox)
	} else if (view !== `code`) {
		visibleExhibits.observe(exhibit)
	}
}

const visibleExhibits = new IntersectionObserver(
	(entries) => {
		for (const { target, isIntersecting } of entries) {
			if (isIntersecting) syncExhibit(target as HTMLElement, true)
		}
	},
	{ rootMargin: `120px 0px` },
)

const layouts = new ResizeObserver((entries) => {
	for (const { target } of entries) syncExhibit(target as HTMLElement)
})

export function initializeExhibitLayouts(): void {
	for (const exhibit of document.querySelectorAll(
		`code-block[data-exhibit-source]`,
	))
		layouts.observe(exhibit)
}

export function resetExhibitLayouts(): void {
	layouts.disconnect()
	visibleExhibits.disconnect()
}

export function selectExhibitTab(tab: HTMLButtonElement): void {
	const exhibit = tab.closest<HTMLElement>(`code-block[data-exhibit-source]`)!
	const selected = tab.dataset[`exhibitTab`]
	if (selected !== `code` && !isLiveTab(selected)) return
	if (isLiveTab(selected)) exhibit.dataset[`exhibitLiveView`] = selected
	exhibit.dataset[`exhibitView`] = selected
	syncExhibit(exhibit, true)
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
