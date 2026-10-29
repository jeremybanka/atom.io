// Small application boundaries shared by the before and after exhibits.
export type Product = { id: string; name: string }
export type Account = { name: string }
export type Job = { complete: boolean; progress: number }

async function request<T>(path: string, options?: RequestInit): Promise<T> {
	const response = await fetch(path, options)
	if (!response.ok) throw new Error(`Request failed: ${response.status}`)
	return response.json()
}
export const loadAccount = (id: string): Promise<Account> =>
	request(`/api/accounts/${encodeURIComponent(id)}`)
export const searchProducts = (query: string): Promise<Product[]> =>
	request(`/api/products?q=${encodeURIComponent(query)}`)
export const readJob = (id: string, signal: AbortSignal): Promise<Job> =>
	request(`/api/jobs/${encodeURIComponent(id)}`, { signal })
export async function saveDraft(draftId: string, text: string): Promise<void> {
	const response = await fetch(`/api/drafts/${encodeURIComponent(draftId)}`, {
		method: `PUT`,
		body: text,
	})
	if (!response.ok) throw new Error(`Save failed: ${response.status}`)
}
export async function sendMessage(text: string): Promise<void> {
	const response = await fetch(`/api/messages`, { method: `POST`, body: text })
	if (!response.ok) throw new Error(`Send failed: ${response.status}`)
}
export function recordVisit(screen: string): void {
	navigator.sendBeacon(`/api/visits`, JSON.stringify({ screen }))
}
export const initializeApplication = (): Promise<Account> =>
	request(`/api/session`)

// A tiny imperative widget stand-in; the same boundary can wrap a map SDK.
export function createMap(node: HTMLElement): {
	setZoom: (zoom: number) => void
	destroy: () => void
} {
	const canvas = document.createElement(`div`)
	node.append(canvas)
	return {
		setZoom: (zoom) => {
			canvas.textContent = `Map zoom: ${zoom}`
		},
		destroy: () => {
			canvas.remove()
		},
	}
}
