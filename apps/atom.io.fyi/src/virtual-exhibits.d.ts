// eslint-disable-next-line quotes
declare module "virtual:atom-io-exhibits" {
	export const exhibits: Record<string, string>
	export const sandboxSources: ReadonlySet<string>
}

// eslint-disable-next-line quotes
declare module "virtual:atom-io-exhibit-sandboxes" {
	export const sandboxes: ReadonlyMap<
		string,
		() => Promise<Record<string, unknown>>
	>
}
