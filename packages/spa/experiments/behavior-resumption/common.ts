/** Shared fixture only. The label algorithm is identical across all controls. */
export interface Props {
	count: number
	work: number
	precomputed: boolean
	labels?: string[]
	below: boolean
}

declare global {
	interface Window {
		__setups?: number
	}
}

export function label(id: number, work: number): string {
	let value = id + 1
	for (let index = 0; index < work; index++)
		value = (Math.imul(value, 1664525) + 1013904223) >>> 0
	return `Product ${id + 1} · ${value % 999}`
}

export function setupCount(): void {
	if (typeof window !== `undefined`) window.__setups = (window.__setups ?? 0) + 1
}

export function initial(_id: number): number {
	return 0
}
