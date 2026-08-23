import {
	expect,
	test,
	type Browser,
	type BrowserContext,
	type Page,
} from "@playwright/test"
import { SeededScenarioRandom } from "atom.io/realtime-testing"

import {
	createMarkdownCollaborationHttpServer,
	type MarkdownCollaborationHttpServer,
} from "../../node/http-server.ts"

const EDITOR = `[data-lexical-editor="true"]`
const WRITER_MARKER = `[WRITER-PREFIX]`
const BACKEND_PORT = 3_027

let backend: MarkdownCollaborationHttpServer

type Clients = {
	readonly maya: Page
	readonly mayaContext: BrowserContext
	readonly theo: Page
	readonly theoContext: BrowserContext
}

type CursorSample = {
	readonly end: number | null
	readonly kind: number
	readonly length: number
	readonly phase: number
	readonly rect: {
		readonly height: number
		readonly left: number
		readonly top: number
	} | null
}

async function openClients(browser: Browser): Promise<Clients> {
	const mayaContext = await browser.newContext()
	const theoContext = await browser.newContext()
	const maya = await mayaContext.newPage()
	const theo = await theoContext.newPage()
	await Promise.all([maya.goto(`/?as=maya`), theo.goto(`/?as=theo`)])
	await Promise.all([
		maya.locator(EDITOR).waitFor({ state: `visible` }),
		theo.locator(EDITOR).waitFor({ state: `visible` }),
	])
	await Promise.all([waitForSaved(maya), waitForSaved(theo)])
	return { maya, mayaContext, theo, theoContext }
}

async function closeClients(clients: Clients): Promise<void> {
	await Promise.all([clients.mayaContext.close(), clients.theoContext.close()])
}

async function sourceText(page: Page): Promise<string> {
	const text = await page.locator(EDITOR).innerText()
	// Chromium exposes Lexical's managed empty-paragraph <br> as one visual
	// newline even though the editor model contains zero UTF-16 units.
	return text === `\n` ? `` : text
}

async function waitForSaved(page: Page): Promise<void> {
	await expect(page.locator(`footer strong`)).toHaveText(`All changes saved`, {
		timeout: 10_000,
	})
}

async function waitForText(page: Page, expected: string): Promise<void> {
	await expect.poll(() => sourceText(page), { timeout: 10_000 }).toBe(expected)
}

async function moveCaret(page: Page, offset: number): Promise<void> {
	if (!Number.isSafeInteger(offset) || offset < 0) {
		throw new Error(`Caret offset must be a non-negative integer.`)
	}
	await page.locator(EDITOR).click()
	await page.keyboard.press(`ControlOrMeta+Home`)
	for (let index = 0; index < offset; index++) {
		await page.keyboard.press(`ArrowRight`)
	}
}

function graphemeBoundaries(value: string): readonly number[] {
	const boundaries = [0]
	for (const { index, segment } of new Intl.Segmenter(undefined, {
		granularity: `grapheme`,
	}).segment(value)) {
		const end = index + segment.length
		if (end > boundaries.at(-1)!) boundaries.push(end)
	}
	return boundaries
}

async function selectGraphemeRange(
	page: Page,
	startIndex: number,
	endIndex: number,
): Promise<void> {
	await moveCaret(page, startIndex)
	for (let index = startIndex; index < endIndex; index++) {
		await page.keyboard.press(`Shift+ArrowRight`)
	}
}

async function focusLineStart(page: Page, prefix: string): Promise<void> {
	const line = page
		.locator(`${EDITOR} [data-lexical-text="true"]`)
		.filter({ hasText: new RegExp(`^${prefix.replaceAll(`.`, `\\.`)}`) })
		.first()
	await expect(line).toBeVisible()
	// Click the first rendered row, not the locator's visual center: long logical
	// lines can wrap, and Home operates on the clicked visual row.
	await line.click({ position: { x: 2, y: 2 } })
	await page.keyboard.press(`Home`)
}

async function typeLiteral(
	page: Page,
	value: string,
	delay = 35,
): Promise<void> {
	for (const character of value) {
		if (character === `\n`) await page.keyboard.press(`Enter`)
		else await page.keyboard.type(character)
		if (delay > 0) await page.waitForTimeout(delay)
	}
}

test.describe(`Mosaic text editor browser conformance`, () => {
	test.beforeEach(async () => {
		backend = await createMarkdownCollaborationHttpServer({ port: BACKEND_PORT })
	})

	test.afterEach(async () => {
		await backend.close()
	})

	test(`delete-all and immediate retyping preserve exact intent`, async ({
		browser,
	}) => {
		const clients = await openClients(browser)
		try {
			expect((await sourceText(clients.maya)).length).toBeGreaterThan(0)
			const editor = clients.maya.locator(EDITOR)
			await editor.click()
			await clients.maya.keyboard.press(`ControlOrMeta+A`)
			await clients.maya.keyboard.press(`Backspace`)
			expect(await sourceText(clients.maya)).toBe(``)

			const replacement = `[RESET-ALL] fresh text`
			let expected = ``
			for (const character of replacement) {
				await clients.maya.keyboard.type(character)
				expected += character
				expect(await sourceText(clients.maya)).toBe(expected)
				await clients.maya.waitForTimeout(45)
			}
			await waitForSaved(clients.maya)
			await waitForText(clients.theo, replacement)
			await clients.theo.reload()
			await clients.theo.locator(EDITOR).waitFor({ state: `visible` })
			await waitForText(clients.theo, replacement)
		} finally {
			await closeClients(clients)
		}
	})

	test(`typing from a settled empty-row boundary stays on that row`, async ({
		browser,
	}) => {
		const clients = await openClients(browser)
		try {
			await focusLineStart(clients.maya, `1.`)
			await clients.maya.keyboard.press(`Enter`)
			await clients.maya.keyboard.press(`Enter`)
			await clients.maya.keyboard.press(`Enter`)
			await waitForSaved(clients.maya)

			const afterBlanks = await sourceText(clients.maya)
			const list = afterBlanks.indexOf(`1.`)
			expect(list).toBeGreaterThan(0)
			await focusLineStart(clients.maya, `1.`)
			await clients.maya.keyboard.press(`Enter`)
			await waitForSaved(clients.maya)
			await clients.maya.keyboard.press(`ArrowUp`)
			await typeLiteral(clients.maya, `[EMPTY-LINE]`, 70)
			await waitForSaved(clients.maya)

			const settled = await sourceText(clients.maya)
			expect(settled).toContain(`\n[EMPTY-LINE]\n1.`)
			expect(settled).not.toContain(`[EMPTY-LINE]1.`)
			await waitForText(clients.theo, settled)
			await clients.theo.reload()
			await clients.theo.locator(EDITOR).waitFor({ state: `visible` })
			await waitForText(clients.theo, settled)
		} finally {
			await closeClients(clients)
		}
	})

	test(`seeded rapid replacements preserve a plain-text oracle`, async ({
		browser,
	}) => {
		test.setTimeout(90_000)
		test.info().annotations.push({
			description: `0x510c10`,
			type: `seed`,
		})
		const clients = await openClients(browser)
		try {
			let oracle = await sourceText(clients.maya)
			const random = new SeededScenarioRandom(0x51_0c_10)
			const alphabet = [`x`, `y`, ` `, `!`, `😀`] as const

			for (let step = 0; step < 40; step++) {
				const boundaries = graphemeBoundaries(oracle)
				const startIndex = random.integer(boundaries.length)
				const removable = Math.min(3, boundaries.length - 1 - startIndex)
				const removed = removable === 0 ? 0 : random.integer(removable + 1)
				const inserted = random.pick(alphabet)
				const endIndex = startIndex + removed
				const start = boundaries[startIndex]
				const end = boundaries[endIndex]
				await selectGraphemeRange(clients.maya, startIndex, endIndex)
				await clients.maya.keyboard.insertText(inserted)
				oracle = `${oracle.slice(0, start)}${inserted}${oracle.slice(end)}`
				expect(
					await sourceText(clients.maya),
					`seed 0x510c10 step ${step}: replace ${start}..${end} with ${JSON.stringify(inserted)}`,
				).toBe(oracle)
				await clients.maya.waitForTimeout(random.pick([20, 45, 90, 180]))
			}

			await waitForSaved(clients.maya)
			await waitForText(clients.theo, oracle)
			expect(await sourceText(clients.maya)).toBe(oracle)
		} finally {
			await closeClients(clients)
		}
	})

	test(`remote cursors follow their semantic target in every frame`, async ({
		browser,
	}) => {
		const clients = await openClients(browser)
		try {
			const fixture = await sourceText(clients.maya)
			const kind = fixture.lastIndexOf(`kind`)
			await moveCaret(clients.theo, kind)
			await clients.theo.keyboard.press(`ArrowRight`)
			await clients.theo.keyboard.press(`ArrowLeft`)
			const presence = clients.maya.locator(
				`collaborator-presence[data-collaborator="Theo Brooks"]`,
			)
			await expect(presence).toHaveCount(1)
			await expect(presence).toHaveAttribute(`data-selection-end`, String(kind))
			const session = await presence.getAttribute(`data-session`)
			expect(session).not.toBeNull()

			await clients.maya.evaluate(
				({ session: exactSession }) => {
					const target = window as unknown as {
						__mosaicCursorFrame?: number
						__mosaicCursorSamples?: CursorSample[]
					}
					target.__mosaicCursorSamples = []
					let phase = 0
					const sample = (): void => {
						const root = document.querySelector<HTMLElement>(
							`[data-lexical-editor="true"]`,
						)
						const text = root?.innerText ?? ``
						const overlay = document.querySelector<HTMLElement>(
							`collaborator-presence[data-session="${exactSession}"]`,
						)
						const caret =
							overlay?.querySelector<HTMLElement>(`collaborator-caret`)
						const rect = caret?.getBoundingClientRect()
						target.__mosaicCursorSamples!.push({
							end:
								overlay === null
									? null
									: Number(overlay.getAttribute(`data-selection-end`)),
							kind: text.lastIndexOf(`kind`),
							length: text.length,
							phase: phase++,
							rect:
								rect === undefined
									? null
									: { height: rect.height, left: rect.left, top: rect.top },
						})
						target.__mosaicCursorFrame = requestAnimationFrame(sample)
					}
					target.__mosaicCursorFrame = requestAnimationFrame(sample)
				},
				{ session },
			)

			await moveCaret(clients.maya, 0)
			await typeLiteral(clients.maya, WRITER_MARKER, 80)
			await clients.maya.waitForTimeout(500)
			const samples = await clients.maya.evaluate(() => {
				const target = window as unknown as {
					__mosaicCursorFrame?: number
					__mosaicCursorSamples?: CursorSample[]
				}
				if (target.__mosaicCursorFrame !== undefined) {
					cancelAnimationFrame(target.__mosaicCursorFrame)
				}
				return target.__mosaicCursorSamples ?? []
			})
			expect(samples.length).toBeGreaterThan(WRITER_MARKER.length)
			const invalid = samples.filter(
				(sample) =>
					sample.end === null ||
					sample.rect === null ||
					sample.rect.height === 0 ||
					sample.end !== sample.kind ||
					sample.end === sample.length,
			)
			expect(invalid, JSON.stringify(invalid.slice(0, 12), null, 2)).toEqual([])

			const expected = `${WRITER_MARKER}${fixture}`
			await waitForSaved(clients.maya)
			await waitForText(clients.theo, expected)
			expect(await sourceText(clients.maya)).toBe(expected)
			expect(await clients.theo.locator(`footer strong`).textContent()).toBe(
				`All changes saved`,
			)
		} finally {
			await closeClients(clients)
		}
	})
})
