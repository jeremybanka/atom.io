// eslint-disable-next-line quotes
declare module "virtual:atom-io-exhibits" {
	export const exhibits: Record<string, string>
	export const sandboxViews: Partial<
		Record<string, { ecology: boolean; preview: boolean }>
	>
}

// eslint-disable-next-line quotes
declare module "virtual:atom-io-exhibit-sandboxes" {
	export const sandboxes: ReadonlyMap<
		string,
		{
			// oxlint-disable-next-line typescript/consistent-type-imports -- Keep this virtual module declaration ambient.
			preview: import("../scripts/exhibit-sandboxes.ts").ExhibitFramework | null // eslint-disable-line quotes
			load(): Promise<Record<string, unknown>>
		}
	>
}
