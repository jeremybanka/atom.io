import {
	IncrementalMarkdownParser,
	type MarkdownSourceBlock,
} from "../src/incremental-markdown.ts"
import { markdownVirtualWindow } from "../src/virtualization.ts"

const block = (
	text: string,
	index: number,
	key = `run:${index}`,
): MarkdownSourceBlock => ({
	anchor: { affinity: `right`, offset: index, runId: `run` },
	end: index + text.length,
	key,
	start: index,
	text,
})

describe(`incremental Markdown rendering`, () => {
	test(`propagates fences to a stable boundary and reuses the untouched suffix`, async () => {
		const parser = new IncrementalMarkdownParser()
		const first = [
			block(`# Heading`, 0),
			block(`paragraph`, 10),
			block(`\`\`\`ts`, 20),
			block(`const x = 1`, 30),
			block(`\`\`\``, 45),
			block(`tail`, 50),
		]
		const initial = await parser.parse(first, { yieldAfterUtf16Units: 8 })
		expect(initial.blocks.map(({ kind }) => kind)).toEqual([
			`heading`,
			`paragraph`,
			`code`,
			`paragraph`,
		])
		expect(initial.instrumentation.parsedBlocks).toBe(6)

		const edited = [...first]
		edited[3] = block(`const x = 2`, 30)
		const reparsed = await parser.parse(edited, { yieldAfterUtf16Units: 8 })
		expect(reparsed.blocks.find(({ kind }) => kind === `code`)?.text).toBe(
			`const x = 2`,
		)
		expect(reparsed.instrumentation.parsedBlocks).toBeLessThan(4)
		expect(reparsed.instrumentation.reusedBlocks).toBeGreaterThan(2)
		expect(reparsed.instrumentation.stableBoundaryIndex).toBe(5)
		expect(reparsed.instrumentation.scannedUtf16Units).toBeLessThan(
			first.reduce((sum, item) => sum + item.text.length, 0),
		)
	})

	test(`cancels stale expensive work off the caller's input turn`, async () => {
		const parser = new IncrementalMarkdownParser()
		const large = Array.from({ length: 2_000 }, (_, index) =>
			block(`paragraph ${index} ${`x`.repeat(64)}`, index * 80),
		)
		const stale = parser.parse(large, { yieldAfterUtf16Units: 128 })
		const latest = parser.parse([block(`# Latest`, 0)], {
			yieldAfterUtf16Units: 128,
		})
		expect((await stale).instrumentation.canceled).toBe(true)
		expect((await latest).blocks).toMatchObject([
			{ kind: `heading`, text: `Latest` },
		])
	})

	test(`keeps source and preview windows bounded at a deterministic 50 MB length`, () => {
		const totalUtf16Units = 56_384_800
		for (const scrollTop of [0, 1_000_000, 15_000_000]) {
			const window = markdownVirtualWindow(
				{ height: 720, scrollTop },
				{
					averageUtf16UnitsPerRow: 88,
					overscanRows: 24,
					rowHeight: 24,
					totalUtf16Units,
				},
			)
			expect(window.range.end - window.range.start).toBeLessThan(65_536)
			expect(window.topSpacer + window.bottomSpacer).toBeLessThan(
				totalUtf16Units,
			)
		}
	})
})
