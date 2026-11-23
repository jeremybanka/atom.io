import { Silo } from "atom.io"
import { IMPLICIT } from "atom.io/internal"
import { sandboxes } from "virtual:atom-io-exhibit-sandboxes"

import { mountExhibitPreview } from "./exhibit-preview.ts"
import {
	EXHIBIT_VIEW_MESSAGE,
	type ExhibitView,
	isExhibitView,
} from "./exhibit-view.ts"

function createStorage(): Storage {
	const entries = new Map<string, string>()
	return {
		get length() {
			return entries.size
		},
		clear() {
			entries.clear()
		},
		getItem(key: unknown) {
			return entries.get(String(key)) ?? null
		},
		key(index) {
			return [...entries.keys()][index] ?? null
		},
		removeItem(key: unknown) {
			entries.delete(String(key))
		},
		setItem(key: unknown, value: unknown) {
			entries.set(String(key), String(value))
		},
	}
}

type Sandbox = NonNullable<ReturnType<typeof sandboxes.get>>

async function loadWorld(sandbox: Sandbox) {
	// Keep example storage in this frame, including during development.
	Object.defineProperties(window, {
		localStorage: { value: createStorage() },
		sessionStorage: { value: createStorage() },
	})
	const module = await sandbox.load()
	const silo = Object.values(module).find(
		(value): value is Silo => value instanceof Silo,
	)
	return { component: module[`default`], store: silo?.store ?? IMPLICIT.STORE }
}

const ecology = document.querySelector<HTMLElement>(`#ecology`)!
const ecologyStatus = ecology.querySelector(`p`)!
const preview = document.querySelector<HTMLElement>(`#preview`)!
const previewHost = document.querySelector<HTMLElement>(`#preview-content`)!
const previewStatus = document.querySelector<HTMLElement>(`#preview-status`)!
const previewFramework =
	document.querySelector<HTMLImageElement>(`#preview-framework`)!
// React and Solid lockups come from the projects' published brand assets.
// https://github.com/reactjs/react.dev/tree/main/public/images/brand
// https://www.solidjs.com/media/
const frameworkNames = { react: `React`, solid: `Solid`, spa: `@atom.io/spa` }

function report(status: HTMLElement, message: string, error: unknown): void {
	status.hidden = false
	status.textContent = `${message} ${error instanceof Error ? error.message : String(error)}`
}

function startSandbox(sandbox: Sandbox): void {
	let world: ReturnType<typeof loadWorld> | undefined
	const getWorld = () => (world ??= loadWorld(sandbox))
	const disposers: (() => void)[] = []
	let closed = false
	let startedEcology = false
	let startedPreview = false
	let panel: HTMLElement | null = null
	window.addEventListener(`pagehide`, (event) => {
		if (event.persisted) return
		closed = true
		for (const dispose of disposers) dispose()
	})

	async function startEcology(): Promise<void> {
		try {
			const [{ store }, { mountEcology }] = await Promise.all([
				getWorld(),
				import(`@atom.io/devtools/ecology`),
			])
			if (closed) return
			const explorer = mountEcology(ecology, { store })
			disposers.push(explorer.dispose)
			panel = ecology.querySelector(`ecology-panel`)
			if (panel) panel.hidden = ecology.hidden
			ecologyStatus.remove()
		} catch (error) {
			report(ecologyStatus, `This exhibit could not run in the sandbox.`, error)
		}
	}

	const previewError = (error: unknown) => {
		report(previewStatus, `This component could not run in the preview.`, error)
	}
	async function startPreview(): Promise<void> {
		try {
			const { component, store } = await getWorld()
			if (closed || !sandbox.preview) return
			previewFramework.src = `/exhibit-frameworks/${sandbox.preview}.svg`
			previewFramework.alt = frameworkNames[sandbox.preview]
			previewFramework.hidden = false
			previewStatus.hidden = true
			const dispose = await mountExhibitPreview(
				sandbox.preview,
				component,
				previewHost,
				store,
				previewError,
			)
			if (closed) dispose()
			else disposers.push(dispose)
		} catch (error) {
			previewError(error)
		}
	}

	function show(view: ExhibitView): void {
		const showEcology = view === `ecology` || view === `both`
		const showPreview = view === `preview` || view === `both`
		document.body.dataset[`exhibitView`] = view
		ecology.hidden = !showEcology
		preview.hidden = !showPreview
		if (panel) panel.hidden = !showEcology
		if (showEcology && !startedEcology) {
			startedEcology = true
			void startEcology()
		}
		if (showPreview && !startedPreview) {
			startedPreview = true
			void startPreview()
		}
	}

	window.addEventListener(`message`, (event: MessageEvent<unknown>) => {
		if (
			event.source !== window.parent ||
			!event.data ||
			typeof event.data !== `object`
		)
			return
		if (
			`type` in event.data &&
			event.data.type === EXHIBIT_VIEW_MESSAGE &&
			`view` in event.data &&
			isExhibitView(event.data.view)
		)
			show(event.data.view)
	})
	const initial = new URLSearchParams(location.search).get(`view`)
	if (isExhibitView(initial)) show(initial)
}

try {
	const source = decodeURIComponent(location.hash.slice(1))
	const embedded = window.parent !== window
	const sandbox =
		embedded && (import.meta.env.DEV || window.origin === `null`)
			? sandboxes.get(source)
			: undefined
	if (sandbox) startSandbox(sandbox)
	else {
		ecology.hidden = false
		ecologyStatus.textContent = `No runnable exhibit was selected.`
	}
} catch (error) {
	ecology.hidden = false
	report(ecologyStatus, `This exhibit could not run in the sandbox.`, error)
}
