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
		{
			// oxlint-disable-next-line typescript/consistent-type-imports -- Keep this virtual module declaration ambient.
			framework: import("../scripts/exhibit-sandboxes.ts").ExhibitFramework // eslint-disable-line quotes
			load(): Promise<{ default: unknown }>
		}
	>
}

// eslint-disable-next-line quotes
declare module "virtual:atom-io-exhibit-sandboxes" {
	export const sandboxes: ReadonlyMap<
		string,
		() => Promise<Record<string, unknown>>
	>
}
