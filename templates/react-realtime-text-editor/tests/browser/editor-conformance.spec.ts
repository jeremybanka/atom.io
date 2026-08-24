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

type ColorSchemeSnapshot = {
	readonly editorBackground: string
	readonly editorInk: string
	readonly footerBackground: string
	readonly pageBackground: string
}

type CursorSamplerWindow = Window & {
	__mosaicCursorFrame?: number
	__mosaicCursorSamples?: CursorSample[]
}

type VisibleCursorSample = {
	readonly caret: {
		readonly height: number
		readonly left: number
		readonly top: number
	} | null
	readonly expected: {
		readonly height: number
		readonly left: number
		readonly top: number
	} | null
	readonly phase: number
	readonly reason: `animation-frame` | `mutation`
	readonly overlayCount: number
	readonly selectionEnd: number | null
	readonly session: string | null
	readonly targetIndex: number
	readonly textLength: number
}

type VisibleCursorSamplerWindow = Window & {
	__mosaicVisibleCursorFrame?: number
	__mosaicVisibleCursorObserver?: MutationObserver
	__mosaicVisibleCursorPhase?: number
	__mosaicVisibleCursorSamples?: VisibleCursorSample[]
}

type WriterOrderObservation = {
	readonly activeElement: string | null
	readonly actual: string
	readonly anchorOffset: number | null
	readonly anchorText: string | null
	readonly character: string
	readonly collapsed: boolean | null
	readonly expected: string
	readonly index: number
	readonly phase: `immediate` | `paced`
	readonly status: string
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

async function colorSchemeSnapshot(page: Page): Promise<ColorSchemeSnapshot> {
	return page.evaluate(() => {
		const editorPane = document.querySelector(`editor-pane`)
		const editor = document.querySelector(`[data-lexical-editor="true"]`)
		const footer = document.querySelector(`footer`)
		if (editorPane === null || editor === null || footer === null) {
			throw new Error(`The themed editor surface is not ready.`)
		}
		return {
			editorBackground: getComputedStyle(editorPane).backgroundColor,
			editorInk: getComputedStyle(editor).color,
			footerBackground: getComputedStyle(footer).backgroundColor,
			pageBackground: getComputedStyle(document.documentElement).backgroundColor,
		}
	})
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

async function observeWriterOrder(
	page: Page,
	input: Omit<
		WriterOrderObservation,
		| `activeElement`
		| `actual`
		| `anchorOffset`
		| `anchorText`
		| `collapsed`
		| `status`
	>,
): Promise<WriterOrderObservation> {
	const browser = await page.evaluate((editorSelector) => {
		const root = document.querySelector<HTMLElement>(editorSelector)
		const selection = window.getSelection()
		const anchor = selection?.anchorNode
		return {
			activeElement:
				document.activeElement instanceof HTMLElement
					? (document.activeElement.getAttribute(`data-lexical-editor`) ??
						document.activeElement.tagName)
					: null,
			actual: root?.innerText === `\n` ? `` : (root?.innerText ?? ``),
			anchorOffset: selection?.anchorOffset ?? null,
			anchorText: anchor instanceof Text ? anchor.data : null,
			collapsed: selection?.isCollapsed ?? null,
			status: document.querySelector(`footer strong`)?.textContent ?? ``,
		}
	}, EDITOR)
	return { ...input, ...browser }
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

async function startCursorSampler(
	page: Page,
	session: string,
	semanticTarget: string,
): Promise<void> {
	await page.evaluate(
		({ exactSession, targetText }) => {
			const target = window as CursorSamplerWindow
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
				const caret = overlay?.querySelector<HTMLElement>(`collaborator-caret`)
				const rect = caret?.getBoundingClientRect()
				target.__mosaicCursorSamples!.push({
					end:
						overlay === null
							? null
							: Number(overlay.getAttribute(`data-selection-end`)),
					kind: text.lastIndexOf(targetText),
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
		{ exactSession: session, targetText: semanticTarget },
	)
}

async function stopCursorSampler(page: Page): Promise<readonly CursorSample[]> {
	return page.evaluate(() => {
		const target = window as CursorSamplerWindow
		if (target.__mosaicCursorFrame !== undefined) {
			cancelAnimationFrame(target.__mosaicCursorFrame)
		}
		return target.__mosaicCursorSamples ?? []
	})
}

async function startVisibleCursorSampler(
	page: Page,
	collaborator: string,
	semanticTarget: string,
): Promise<void> {
	await page.evaluate(
		({ collaboratorName, targetText }) => {
			const target = window as VisibleCursorSamplerWindow
			target.__mosaicVisibleCursorSamples = []
			target.__mosaicVisibleCursorPhase = 0

			const expectedCaret = (): DOMRect | null => {
				const root = document.querySelector<HTMLElement>(
					`[data-lexical-editor="true"]`,
				)
				if (root === null) return null
				const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
				let match: { readonly index: number; readonly node: Text } | null = null
				for (
					let node = walker.nextNode();
					node !== null;
					node = walker.nextNode()
				) {
					if (!(node instanceof Text)) continue
					const index = node.data.lastIndexOf(targetText)
					if (index >= 0) match = { index, node }
				}
				if (match === null) return null
				const range = document.createRange()
				range.setStart(match.node, match.index)
				range.setEnd(match.node, match.index + 1)
				return range.getBoundingClientRect()
			}

			const capture = (reason: `animation-frame` | `mutation`): void => {
				const root = document.querySelector<HTMLElement>(
					`[data-lexical-editor="true"]`,
				)
				const expected = expectedCaret()
				const overlays = document.querySelectorAll<HTMLElement>(
					`collaborator-presence[data-collaborator="${collaboratorName}"]`,
				)
				const matchedOverlays: readonly (HTMLElement | null)[] =
					overlays.length === 0 ? [null] : [...overlays]
				for (const overlay of matchedOverlays) {
					const caret = overlay?.querySelector<HTMLElement>(`collaborator-caret`)
					const caretRect = caret?.getBoundingClientRect()
					const selectionEnd = overlay?.getAttribute(`data-selection-end`)
					target.__mosaicVisibleCursorSamples!.push({
						caret:
							caretRect === undefined
								? null
								: {
										height: caretRect.height,
										left: caretRect.left,
										top: caretRect.top,
									},
						expected:
							expected === null
								? null
								: {
										height: expected.height,
										left: expected.left,
										top: expected.top,
									},
						phase: target.__mosaicVisibleCursorPhase ?? 0,
						reason,
						overlayCount: overlays.length,
						selectionEnd:
							selectionEnd !== null && Number.isFinite(Number(selectionEnd))
								? Number(selectionEnd)
								: null,
						session: overlay?.getAttribute(`data-session`) ?? null,
						targetIndex: root?.innerText.lastIndexOf(targetText) ?? -1,
						textLength: root?.innerText.length ?? 0,
					})
				}
				target.__mosaicVisibleCursorPhase =
					(target.__mosaicVisibleCursorPhase ?? 0) + 1
			}

			target.__mosaicVisibleCursorObserver = new MutationObserver(() => {
				capture(`mutation`)
			})
			const overlayRoot = document.querySelector(`collaborator-overlays`)
			if (overlayRoot !== null) {
				target.__mosaicVisibleCursorObserver.observe(overlayRoot, {
					attributeFilter: [
						`data-selection-end`,
						`data-selection-start`,
						`style`,
					],
					attributes: true,
					childList: true,
					subtree: true,
				})
			}
			const frame = (): void => {
				capture(`animation-frame`)
				target.__mosaicVisibleCursorFrame = requestAnimationFrame(frame)
			}
			capture(`mutation`)
			target.__mosaicVisibleCursorFrame = requestAnimationFrame(frame)
		},
		{ collaboratorName: collaborator, targetText: semanticTarget },
	)
}

async function stopVisibleCursorSampler(
	page: Page,
): Promise<readonly VisibleCursorSample[]> {
	return page.evaluate(() => {
		const target = window as VisibleCursorSamplerWindow
		if (target.__mosaicVisibleCursorFrame !== undefined) {
			cancelAnimationFrame(target.__mosaicVisibleCursorFrame)
		}
		target.__mosaicVisibleCursorObserver?.disconnect()
		return target.__mosaicVisibleCursorSamples ?? []
	})
}

test.describe(`Mosaic text editor browser conformance`, () => {
	test.beforeEach(async () => {
		backend = await createMarkdownCollaborationHttpServer({ port: BACKEND_PORT })
	})

	test.afterEach(async () => {
		await backend.close()
	})

	test(`starts dark and follows the system light color scheme`, async ({
		page,
	}) => {
		await page.emulateMedia({ colorScheme: `dark` })
		await page.goto(`/?as=maya`)
		await expect(page.locator(`meta[name="color-scheme"]`)).toHaveAttribute(
			`content`,
			`dark light`,
		)
		await page.locator(EDITOR).waitFor({ state: `visible` })
		await waitForSaved(page)
		expect(await colorSchemeSnapshot(page)).toEqual({
			editorBackground: `rgb(28, 25, 34)`,
			editorInk: `rgb(229, 223, 234)`,
			footerBackground: `rgb(25, 23, 31)`,
			pageBackground: `rgb(18, 16, 22)`,
		})

		await page.emulateMedia({ colorScheme: `light` })
		await expect
			.poll(() => colorSchemeSnapshot(page))
			.toEqual({
				editorBackground: `rgb(255, 254, 250)`,
				editorInk: `rgb(56, 53, 66)`,
				footerBackground: `rgb(250, 249, 252)`,
				pageBackground: `rgb(243, 242, 247)`,
			})
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
		test.setTimeout(180_000)
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

	test(`human-paced typing on a new line preserves keystroke order`, async ({
		browser,
	}) => {
		test.setTimeout(60_000)
		const clients = await openClients(browser)
		try {
			const editor = clients.maya.locator(EDITOR)
			await editor.click()
			await clients.maya.keyboard.press(`ControlOrMeta+A`)
			await clients.maya.keyboard.press(`Backspace`)
			await waitForText(clients.maya, ``)
			await waitForSaved(clients.maya)
			const fixture = `anchor\n\nsentinel`
			await clients.maya.keyboard.insertText(fixture)
			await waitForText(clients.maya, fixture)
			await waitForSaved(clients.maya)
			await waitForText(clients.theo, fixture)
			const insertion = fixture.indexOf(`\n`) + 1
			await moveCaret(clients.maya, insertion)
			const phrase = `The quick brown fox jumps over the lazy dog`
			const observations: WriterOrderObservation[] = []
			let typed = ``

			for (const [index, character] of [...phrase].entries()) {
				await clients.maya.keyboard.type(character)
				typed += character
				const expected = `${fixture.slice(0, insertion)}${typed}${fixture.slice(insertion)}`
				observations.push(
					await observeWriterOrder(clients.maya, {
						character,
						expected,
						index,
						phase: `immediate`,
					}),
				)
				await clients.maya.waitForTimeout(200)
				observations.push(
					await observeWriterOrder(clients.maya, {
						character,
						expected,
						index,
						phase: `paced`,
					}),
				)

				const firstFailure = observations.find(
					(observation) => observation.actual !== observation.expected,
				)
				expect(
					firstFailure,
					`A human-paced key was committed out of order. First failure:\n${JSON.stringify(firstFailure, null, 2)}\nRecent writer trace:\n${JSON.stringify(observations.slice(-8), null, 2)}`,
				).toBeUndefined()
			}

			const expected = `${fixture.slice(0, insertion)}${phrase}${fixture.slice(insertion)}`
			await waitForSaved(clients.maya)
			await waitForText(clients.theo, expected)
			expect(await sourceText(clients.maya)).toBe(expected)
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
			if (session === null) throw new Error(`Theo's presence has no session.`)

			await startCursorSampler(clients.maya, session, `kind`)

			await moveCaret(clients.maya, 0)
			await typeLiteral(clients.maya, WRITER_MARKER, 80)
			await clients.maya.waitForTimeout(500)
			const samples = await stopCursorSampler(clients.maya)
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

	test(`every painted remote caret remains on its semantic glyph`, async ({
		browser,
	}) => {
		const clients = await openClients(browser)
		try {
			const marker = `CURSOR!!`
			const fixture = await sourceText(clients.maya)
			const rollout = fixture.lastIndexOf(`rollout`)
			expect(rollout).toBeGreaterThan(0)
			await moveCaret(clients.theo, rollout)
			await clients.theo.keyboard.press(`ArrowRight`)
			await clients.theo.keyboard.press(`ArrowLeft`)

			const presence = clients.maya.locator(
				`collaborator-presence[data-collaborator="Theo Brooks"]`,
			)
			await expect(presence).toHaveCount(1)
			await expect(presence).toHaveAttribute(
				`data-selection-end`,
				String(rollout),
			)

			const devtools = await clients.mayaContext.newCDPSession(clients.maya)
			await devtools.send(`Network.enable`)
			await devtools.send(`Network.emulateNetworkConditions`, {
				downloadThroughput: 20_000_000,
				latency: 100,
				offline: false,
				uploadThroughput: 20_000_000,
			})
			await devtools.send(`Emulation.setCPUThrottlingRate`, { rate: 3 })
			await startVisibleCursorSampler(clients.maya, `Theo Brooks`, `rollout`)
			await moveCaret(clients.maya, 0)
			let typed = ``
			for (const character of marker) {
				await clients.maya.keyboard.type(character)
				typed += character
				await expect
					.poll(() => sourceText(clients.maya), { timeout: 2_000 })
					.toBe(`${typed}${fixture}`)
				await clients.maya.waitForTimeout(150)
			}
			await clients.maya.waitForTimeout(750)
			const samples = await stopVisibleCursorSampler(clients.maya)
			expect(samples.length).toBeGreaterThan(30)
			const expectedText = `${marker}${fixture}`

			const invalid = samples.filter((sample) => {
				if (
					sample.overlayCount !== 1 ||
					sample.caret === null ||
					sample.expected === null ||
					sample.selectionEnd !== sample.targetIndex
				) {
					return true
				}
				return (
					Math.abs(sample.caret.left - sample.expected.left) > 1 ||
					Math.abs(sample.caret.top - sample.expected.top) > 1
				)
			})
			const terminal = invalid.filter(
				(sample) =>
					sample.caret !== null &&
					sample.expected !== null &&
					sample.caret.top > sample.expected.top + 50 &&
					sample.selectionEnd !== null &&
					sample.selectionEnd >= sample.textLength - 1,
			)
			expect(
				invalid.length,
				`A user can see every painted cursor, including a stale duplicate or one-frame terminal projection. ${invalid.length}/${samples.length} samples were invalid and ${terminal.length} painted at the document terminus. First failures:\n${JSON.stringify(invalid.slice(0, 6), null, 2)}`,
			).toBe(0)

			await waitForSaved(clients.maya)
			await waitForText(clients.theo, expectedText)
			expect(await sourceText(clients.maya)).toBe(expectedText)
		} finally {
			await closeClients(clients)
		}
	})

	test(`an active remote writer never paints at the document terminus`, async ({
		browser,
	}) => {
		const clients = await openClients(browser)
		try {
			const fixture = await sourceText(clients.maya)
			const rollout = fixture.lastIndexOf(`rollout`)
			expect(rollout).toBeGreaterThan(0)
			await moveCaret(clients.theo, rollout)
			await clients.theo.keyboard.press(`ArrowRight`)
			await clients.theo.keyboard.press(`ArrowLeft`)
			const presence = clients.maya.locator(
				`collaborator-presence[data-collaborator="Theo Brooks"]`,
			)
			await expect(presence).toHaveCount(1)
			await expect(presence).toHaveAttribute(
				`data-selection-end`,
				String(rollout),
			)
			const session = await presence.getAttribute(`data-session`)
			expect(session).not.toBeNull()
			if (session === null) throw new Error(`Theo's presence has no session.`)

			const devtools = await clients.mayaContext.newCDPSession(clients.maya)
			await devtools.send(`Network.enable`)
			await devtools.send(`Network.emulateNetworkConditions`, {
				downloadThroughput: 20_000_000,
				latency: 55,
				offline: false,
				uploadThroughput: 20_000_000,
			})
			await devtools.send(`Emulation.setCPUThrottlingRate`, { rate: 3 })

			await startCursorSampler(clients.maya, session, `rollout`)
			let typed = ``
			for (const character of `[ACTIVE-THEO]`) {
				await clients.theo.keyboard.type(character)
				typed += character
				const expected = `${fixture.slice(0, rollout)}${typed}${fixture.slice(rollout)}`
				expect(await sourceText(clients.theo)).toBe(expected)
				await clients.theo.waitForTimeout(120)
				expect(await sourceText(clients.theo)).toBe(expected)
			}
			await clients.theo.waitForTimeout(600)
			const samples = await stopCursorSampler(clients.maya)
			expect(samples.length).toBeGreaterThan(`[ACTIVE-THEO]`.length)
			const terminal = samples.filter(
				(sample) =>
					sample.end !== null &&
					sample.kind >= 0 &&
					sample.end === sample.length,
			)
			expect(terminal, JSON.stringify(terminal, null, 2)).toEqual([])
			const expected = `${fixture.slice(0, rollout)}[ACTIVE-THEO]${fixture.slice(rollout)}`
			await Promise.all([
				waitForText(clients.maya, expected),
				waitForText(clients.theo, expected),
			])
			await expect(presence).toHaveAttribute(
				`data-selection-end`,
				String(rollout + `[ACTIVE-THEO]`.length),
			)
		} finally {
			await closeClients(clients)
		}
	})
})
