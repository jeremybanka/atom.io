import { act, render, waitFor } from "@testing-library/react"
import type { MosaicTextSelection } from "atom.io/realtime"
import type {
	MosaicTextProjectionClient,
	MosaicTextRangeProjection,
} from "atom.io/realtime-client"
import {
	mosaicTextContiguousEdit,
	transformMosaicTextSelection,
} from "atom.io/realtime-client"
import {
	type MosaicTextEditorView,
	useMosaicTextEditor,
} from "atom.io/realtime-react"
import { SeededScenarioRandom } from "atom.io/realtime-testing"
import type { ReactElement } from "react"

type Peer = { readonly name: string }

type DeferredCommit = {
	readonly input: {
		readonly selection: MosaicTextSelection
		readonly text: string
	}
	resolve(): void
}

type ViewSnapshot = {
	readonly draft: boolean
	readonly remoteEnd: number | null
	readonly text: string
}

function projection(text: string, revision: number): MosaicTextRangeProjection {
	return {
		blocks: [],
		complete: true,
		range: { end: text.length, kind: `utf16-range`, start: 0 },
		revision,
		segments:
			text.length === 0
				? []
				: [
						{
							end: text.length,
							fragments: [{ runId: `revision:${revision}`, start: 0, text }],
							id: `leaf:${revision}`,
							start: 0,
							text,
						},
					],
		text,
	}
}

function generatedText(random: SeededScenarioRandom, maximum: number): string {
	const alphabet = [`a`, `b`, ` `, `\n`, `!`, `😀`, `e\u0301`] as const
	return Array.from({ length: random.integer(maximum + 1) }, () =>
		random.pick(alphabet),
	).join(``)
}

describe(`Mosaic text editor conformance`, () => {
	test(`contiguous edits reconstruct every generated target exactly`, () => {
		for (let seed = 1; seed <= 128; seed++) {
			const random = new SeededScenarioRandom(seed)
			for (let step = 0; step < 64; step++) {
				const before = generatedText(random, 48)
				const after = generatedText(random, 48)
				const edit = mosaicTextContiguousEdit(before, after)
				const reconstructed = `${before.slice(0, edit.start)}${edit.text}${before.slice(edit.end)}`
				expect(reconstructed, `seed ${seed}, step ${step}`).toBe(after)
				expect(edit.start).toBeGreaterThanOrEqual(0)
				expect(edit.end).toBeGreaterThanOrEqual(edit.start)
				expect(edit.end).toBeLessThanOrEqual(before.length)
			}
		}
	})

	test(`selection transforms stay in bounds through reset, newline, and Unicode edits`, () => {
		const cases = [
			{ after: ``, before: `owners`, selection: [6, 6] },
			{ after: `[reset]`, before: ``, selection: [0, 0] },
			{ after: `\n\n1. owners`, before: `1. owners`, selection: [0, 0] },
			{
				after: `before\n[empty]\n1. owners`,
				before: `before\n\n1. owners`,
				selection: [7, 7],
			},
			{ after: `x😀kind`, before: `😀kind`, selection: [2, 2] },
			{ after: `e\u0301 kind`, before: `kind`, selection: [0, 4] },
		] as const
		for (const { after, before, selection } of cases) {
			const transformed = transformMosaicTextSelection(before, after, selection)
			for (const offset of transformed) {
				expect(offset).toBeGreaterThanOrEqual(0)
				expect(offset).toBeLessThanOrEqual(after.length)
			}
		}
	})

	test(`retains the newest local intent across overlapping accepted cuts`, async () => {
		let canonical = `owners\n\nterminal kind`
		let currentProjection = projection(canonical, 0)
		let revision = 0
		let view: MosaicTextEditorView<Peer> | null = null
		const commits: DeferredCommit[] = []
		const snapshots: ViewSnapshot[] = []
		const peerPosition = {
			affinity: `left` as const,
			offset: 0,
			runId: `semantic:kind`,
		}
		const client = {
			positionAtOffset: (offset: number) =>
				Promise.resolve({
					affinity: `left` as const,
					offset,
					runId: `absolute`,
				}),
			readLength: () => Promise.resolve(canonical.length),
			resolvePosition: (position: {
				readonly offset: number
				readonly runId: string | null
			}) =>
				Promise.resolve(
					position.runId === `semantic:kind`
						? canonical.lastIndexOf(`kind`)
						: position.offset,
				),
		} as Pick<
			MosaicTextProjectionClient,
			`positionAtOffset` | `readLength` | `resolvePosition`
		>
		const peers = [
			{
				id: `theo`,
				selection: { anchor: peerPosition, head: peerPosition },
				value: { name: `Theo` },
			},
		] as const
		const Probe = (): ReactElement => {
			view = useMosaicTextEditor({
				client,
				commitDelayMs: 1,
				connected: true,
				documentLength: canonical.length,
				peers,
				projection: currentProjection,
				publishSelection: () => undefined,
				replace: (input) =>
					new Promise<void>((resolve) => {
						commits.push({ input, resolve })
					}),
			})
			snapshots.push({
				draft: view.hasLocalDraft,
				remoteEnd: view.remoteSelections[0]?.end ?? null,
				text: view.text,
			})
			return <output>{view.text}</output>
		}
		const rendered = render(<Probe />)
		await waitFor(() => {
			expect(view?.remoteSelections[0]?.end).toBe(canonical.lastIndexOf(`kind`))
		})
		const firstTrackedSnapshot = snapshots.length

		const intentions = [
			`[owners]\n\nterminal kind`,
			`[owners!]\n\nterminal kind`,
			`[owners!]\n\n\nterminal kind`,
			`[owners!]\n\n\nterminal kind?`,
		] as const
		for (const [index, intention] of intentions.entries()) {
			act(() => {
				view?.onDirty()
				view?.onValueChange(intention, false)
				view?.onSelectionChange(intention.length, intention.length)
			})
			expect(
				(view as unknown as MosaicTextEditorView<Peer>).text,
				`local intent ${index}`,
			).toBe(intention)
			await waitFor(() => {
				expect(commits.length).toBeGreaterThan(index)
			})
			const commit = commits[index]
			const start = commit.input.selection.anchor.offset
			const end = commit.input.selection.head.offset
			canonical = `${canonical.slice(0, start)}${commit.input.text}${canonical.slice(end)}`
			revision++
			currentProjection = projection(canonical, revision)
			act(() => {
				rendered.rerender(<Probe />)
				commit.resolve()
			})
			await waitFor(() => {
				expect(view?.text).toBe(intention)
			})
		}
		await waitFor(() => {
			expect(view?.hasLocalDraft).toBe(false)
		})
		expect(canonical).toBe(intentions.at(-1))

		for (const [index, snapshot] of snapshots
			.slice(firstTrackedSnapshot)
			.entries()) {
			expect(snapshot.remoteEnd, `render ${index}: ${snapshot.text}`).toBe(
				snapshot.text.lastIndexOf(`kind`),
			)
		}
		rendered.unmount()
	})
})
