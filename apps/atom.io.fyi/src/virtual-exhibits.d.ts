// eslint-disable-next-line quotes
declare module "virtual:atom-io-exhibits" {
	export const exhibits: Record<string, string>
	export const sandboxViews: Partial<
		Record<string, { ecology: boolean; preview: boolean }>
	>
}

// eslint-disable-next-line quotes
declare module "virtual:atom-io-exhibit-previews" {
	export const sandboxes: ReadonlyMap<
		string,
		() => Promise<{ default: unknown }>
	>
}

// eslint-disable-next-line quotes
declare module "virtual:atom-io-exhibit-sandboxes" {
	export const sandboxes: ReadonlyMap<
		string,
		() => Promise<Record<string, unknown>>
	>
}
