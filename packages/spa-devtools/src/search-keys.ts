/** Panel-local search shortcuts preserve native find, editing keys and IME input. */
export function isSearchShortcut(event: KeyboardEvent): boolean {
	const target = event.target as HTMLElement
	const editable =
		target.matches(
			`input, textarea, select, [contenteditable]:not([contenteditable="false"])`,
		) || target.isContentEditable
	return (
		((event.ctrlKey || event.metaKey) &&
			event.shiftKey &&
			!event.altKey &&
			event.key.toLowerCase() === `f`) ||
		(!editable &&
			!event.ctrlKey &&
			!event.metaKey &&
			!event.altKey &&
			!event.shiftKey &&
			event.key === `/`)
	)
}
export function moveSearchFocus(
	event: KeyboardEvent,
	results: HTMLElement,
): void {
	if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
	const buttons = [...results.querySelectorAll<HTMLButtonElement>(`button`)]
	const at = buttons.indexOf(event.target as HTMLButtonElement)
	let next: number
	if (event.key === `ArrowDown`) next = (at + 1) % buttons.length
	else if (event.key === `ArrowUp`) next = (at < 1 ? buttons.length : at) - 1
	else if (at !== -1 && event.key === `Home`) next = 0
	else if (at !== -1 && event.key === `End`) next = buttons.length - 1
	else return
	if (buttons[next]) {
		event.preventDefault()
		buttons[next].focus()
	}
}
