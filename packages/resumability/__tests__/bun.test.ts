import { fileURLToPath } from "node:url"

import type { PluginBuilder } from "bun"
import { expect, it, vi } from "vitest"

import resumability from "../src/bun.ts"

it(`registers the transform only for browser builds`, async () => {
	for (const config of [undefined, { target: `bun` }, { target: `node` }]) {
		const onLoad = vi.fn()
		await resumability.setup({ config, onLoad } as unknown as PluginBuilder)
		expect(onLoad).not.toHaveBeenCalled()
	}
})

it.each([
	[undefined, `ts`],
	[`browser`, `tsx`],
	[`browser`, `jsx`],
] as const)(
	`strips server producers before Bun resolves imports (target %s)`,
	async (target, loader) => {
		const onLoad = vi.fn<PluginBuilder[`onLoad`]>()
		await resumability.setup({
			config: { target },
			onLoad,
		} as unknown as PluginBuilder)
		const [{ filter }, load] = onLoad.mock.calls[0]
		expect(filter.test(`reader.tsx`)).toBe(true)
		expect(filter.test(`reader.json`)).toBe(false)

		function read(relative: string) {
			return load({
				path: fileURLToPath(new URL(relative, import.meta.url)),
				loader,
				namespace: `file`,
				defer: async () => {},
			})
		}
		expect(await read(`../src/key.ts`)).toBeUndefined()
		const result = await read(`../exhibits/constant.ts`)
		expect(result).toMatchObject({
			loader,
			contents: expect.stringContaining(`warehouseName`),
		})
		expect(result).not.toMatchObject({
			contents: expect.stringMatching(
				/node:sqlite|astro-client|sourceMappingURL/,
			),
		})
	},
)
