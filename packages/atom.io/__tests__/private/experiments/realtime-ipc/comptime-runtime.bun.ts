type BunPluginBuilder = {
	module: (
		specifier: string,
		load: () => { exports: Record<string, unknown>; loader: `object` },
	) => void
}

declare const Bun: {
	plugin: (options: {
		name: string
		setup: (builder: BunPluginBuilder) => void
	}) => void
}

const comptime = <T>(evaluate: () => T): T => evaluate()

// Room fixtures execute source directly in Bun, outside the Vite transform.
Bun.plugin({
	name: `comptime-runtime`,
	setup: (builder) => {
		builder.module(`comptime`, () => ({
			exports: { comptime },
			loader: `object`,
		}))
	},
})
