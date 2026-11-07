/** Deliberately tiny wire format: finite numeric atoms and direct text bindings. */
export interface CellSnapshot {
	version: 1
	value: number
	text: string[]
}

export function validateId(value: unknown): asserts value is string {
	if (typeof value !== `string` || !/^[a-z][a-z0-9-]{0,63}$/.test(value)) {
		throw new Error(`resume: invalid reference`)
	}
}

export function readSnapshot(text: string): CellSnapshot {
	const value = JSON.parse(text)
	if (
		value?.version !== 1 ||
		!Number.isFinite(value.value) ||
		!Array.isArray(value.text) ||
		value.text.length === 0 ||
		value.text.length > 16
	) {
		throw new Error(`resume: unsupported cell snapshot`)
	}
	for (const id of value.text) validateId(id)
	return value
}

export function readCapture(text: string): string[] {
	const value = JSON.parse(text)
	if (!Array.isArray(value) || value.length === 0 || value.length > 16) {
		throw new Error(`resume: invalid capture`)
	}
	for (const id of value) validateId(id)
	return value
}
