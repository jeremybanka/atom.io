/** Defer the existing editor blur only while focus visits this panel's passive search UI. */
export function createSearchSession(
	panel: HTMLElement,
	search: HTMLElement,
	changed: () => void,
	current: (input: HTMLInputElement) => () => boolean,
): {
	pinned(): HTMLElement | null
	returnFocus(): void
	finish(target: EventTarget | null): void
	dispose(): void
} {
	const doc = panel.ownerDocument
	let origin: HTMLInputElement | null = null
	let valid: () => boolean
	const fresh = () => {
		if (origin && !valid()) {
			if (origin.getAttribute(`aria-label`)?.startsWith(`Rename `))
				origin.value = origin.defaultValue
			origin = null
		}
	}
	let selection: [number | null, number | null] = [null, null]
	const passive = (target: EventTarget | null): boolean =>
		target instanceof doc.defaultView!.Element && search.contains(target)
	const finish = (target: EventTarget | null) => {
		fresh()
		const input = origin
		origin = null
		if (input?.isConnected)
			input.dispatchEvent(
				new doc.defaultView!.FocusEvent(`focusout`, {
					bubbles: true,
					relatedTarget: target,
				}),
			)
		changed()
	}
	const blur = (event: FocusEvent) => {
		const input = event.target
		if (
			!(input instanceof doc.defaultView!.HTMLInputElement) ||
			!input.closest(`.state-leaf`)
		)
			return
		if (!passive(event.relatedTarget)) {
			if (origin === input) {
				origin = null
				changed()
			}
			return
		}
		event.stopImmediatePropagation()
		origin = input
		valid = current(input)
		selection = [input.selectionStart, input.selectionEnd]
		changed()
	}
	const focus = (event: FocusEvent) => {
		fresh()
		if (!origin || passive(event.target)) return
		if (event.target === origin) {
			if (selection[0] !== null && selection[1] !== null)
				origin.setSelectionRange(...(selection as [number, number]))
			changed()
		} else finish(event.target)
	}
	panel.addEventListener(`blur`, blur, true)
	panel.addEventListener(`focusout`, blur, true)
	doc.addEventListener(`focusin`, focus)
	return {
		pinned: () => {
			fresh()
			return origin?.isConnected
				? origin.closest<HTMLElement>(`.state-leaf`)
				: null
		},
		returnFocus() {
			fresh()
			origin?.focus()
		},
		finish,
		dispose() {
			panel.removeEventListener(`blur`, blur, true)
			panel.removeEventListener(`focusout`, blur, true)
			doc.removeEventListener(`focusin`, focus)
			origin = null
		},
	}
}
