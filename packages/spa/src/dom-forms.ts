import type { Scope } from "./core.ts"
import { enqueue, isPresent } from "./core.ts"

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
const changes = new WeakMap<EventListener, EventListener>()
const requests = new WeakMap<Element, () => void>()
const events = [`input`, `change`, `click`]
const wake = () => {}

/** Keep native input events, using per-edit change semantics for text/range controls. */
export function changeHandler(handler: EventListener): EventListener {
	let wrapped = changes.get(handler)
	if (!wrapped) {
		wrapped = (event) => {
			const target = event.target as Control | null
			const editing =
				target?.localName === `textarea` ||
				(target?.localName === `input` &&
					!/^(checkbox|radio|file)$/.test(target.type))
			if (event.type === (editing ? `input` : `change`))
				handler.call(event.currentTarget, event)
		}
		changes.set(handler, wrapped)
	}
	return wrapped
}

export function controlValue(control: Control, value: string | number): void {
	if (
		control.localName === `input` &&
		control.type === `number` &&
		typeof value === `number` &&
		control.value !== `` &&
		Number(control.value) === value
	)
		return
	if (control.value !== String(value)) control.value = String(value)
	if (control.localName === `select`) {
		const select = control as HTMLSelectElement
		if (select.selectedIndex < 0) {
			const first = [...select.options].find((option) => !option.disabled)
			if (first) first.selected = true
		}
	}
}

/** Restore controlled fields after event handlers and all queued option/prop updates. */
export function bindForm(
	control: Control,
	props: Record<string, any>,
	scope: Scope,
): void {
	let active: Event | undefined
	let timer: ReturnType<typeof setTimeout> | undefined
	const restore = () => {
		if (!isPresent(scope) || active?.eventPhase) return
		if (props[`value`] != null) controlValue(control, props[`value`])
		if (control.localName === `input` && props[`checked`] != null) {
			const input = control as HTMLInputElement
			if (input.checked !== Boolean(props[`checked`]))
				input.checked = Boolean(props[`checked`])
		}
	}
	const finish = () => {
		active = undefined
		clearTimeout(timer)
		enqueue(scope, wake)
	}
	const capture = (event: Event) => {
		if (event.type === `click` && !/^(checkbox|radio)$/.test(control.type))
			return
		active = event
		clearTimeout(timer)
		// A stopped native event never reaches the root's bubble listener.
		timer = setTimeout(finish, 0)
	}
	const root = scope._root
	if (!root._forms) {
		root._forms = new Set()
		const end = (event: Event) => {
			const target = event.target as Control
			// Checkbox/radio change follows click and input; its handlers must see the edit.
			if (
				event.type === `click` ||
				(event.type === `input` && /^(checkbox|radio)$/.test(target.type))
			)
				return
			requests.get(target)?.()
			if (target.localName === `input` && target.type === `radio`) {
				const input = target as HTMLInputElement
				for (const peer of (
					input.getRootNode() as ParentNode
				).querySelectorAll<HTMLInputElement>(`input`)) {
					if (
						peer.type === `radio` &&
						peer.name === input.name &&
						peer.form === input.form
					)
						requests.get(peer)?.()
				}
			}
		}
		for (const event of events) root._host!.addEventListener(event, end)
		root._cleanups.add(() => {
			for (const event of events) root._host!.removeEventListener(event, end)
		})
	}
	const forms = root._forms
	forms.add(restore)
	requests.set(control, finish)
	for (const event of events) control.addEventListener(event, capture, true)
	scope._cleanups.add(() => {
		clearTimeout(timer)
		forms.delete(restore)
		requests.delete(control)
		for (const event of events) control.removeEventListener(event, capture, true)
	})
}
