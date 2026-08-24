import { act, render, waitFor } from "@testing-library/react"
import type { MosaicTextSelection } from "atom.io/realtime"
import type {
	MosaicTextProjectionClient,
	MosaicTextRangeProjection,
} from "atom.io/realtime-client"
import {
	mosaicTextContiguousEdit,
	positionAtMosaicTextProjectionOffset,
	resolveMosaicTextProjectionPosition,
	transformMosaicTextSelection,
} from "atom.io/realtime-client"
import {
	type MosaicTextEditorPeer,
	type MosaicTextEditorView,
	useMosaicTextEditor,
} from "atom.io/realtime-react"
import type { ReactElement } from "react"

type Peer = { readonly name: string }

const projected = (
	text: string,
	revision: number,
	options: {
		readonly complete?: boolean
		readonly rangeEnd?: number
		readonly runId?: string
	} = {},
): MosaicTextRangeProjection => ({
	blocks: [],
	complete: options.complete ?? true,
	range: {
		end: options.rangeEnd ?? text.length,
		kind: `utf16-range`,
		start: 0,
	},
	revision,
	segments:
		text.length === 0
			? []
			: [
					{
						end: text.length,
						fragments: [{ runId: options.runId ?? `base`, start: 0, text }],
						id: `leaf:${revision}`,
						start: 0,
						text,
					},
				],
	text,
})

const deferred = () => {
	let resolve = (): void => undefined
	const promise = new Promise<void>((complete) => {
		resolve = complete
	})
	return { promise, resolve }
}

describe(`Mosaic text editing`, () => {
	test(`exposes projection-local mapping and contiguous transforms`, () => {
		const projection = projected(`a😀b`, 7)
		expect(projection.complete).toBe(true)
		expect(projection.revision).toBe(7)
		expect(positionAtMosaicTextProjectionOffset(projection, 3)).toMatchObject({
			affinity: `left`,
			offset: 2,
			runId: `base`,
		})
		expect(
			positionAtMosaicTextProjectionOffset(projection, 3, `right`),
		).toMatchObject({ affinity: `right`, offset: 2, runId: `base` })
		expect(
			resolveMosaicTextProjectionPosition(projection, {
				affinity: `left`,
				offset: 2,
				runId: `base`,
			}),
		).toBe(3)
		expect(positionAtMosaicTextProjectionOffset(projection, -1)).toBeNull()
		expect(positionAtMosaicTextProjectionOffset(projection, 20)).toBeNull()
		expect(
			resolveMosaicTextProjectionPosition(projection, {
				affinity: `left`,
				offset: 0,
				runId: null,
			}),
		).toBeNull()
		const empty = projected(``, 8)
		expect(positionAtMosaicTextProjectionOffset(empty, 0)).toEqual({
			affinity: `left`,
			offset: 0,
			runId: null,
		})
		expect(
			resolveMosaicTextProjectionPosition(empty, {
				affinity: `left`,
				offset: 0,
				runId: null,
			}),
		).toBe(0)
		expect(
			mosaicTextContiguousEdit(`alpha omega`, `alpha careful omega`),
		).toEqual({ end: 6, start: 6, text: `careful ` })
		expect(
			transformMosaicTextSelection(`alpha omega`, `prefix alpha omega`, [6, 11]),
		).toEqual([13, 18])
		expect(
			transformMosaicTextSelection(`prefix alpha`, `prefix`, [12, 12]),
		).toEqual([6, 6])
	})

	test(`brackets collapsed insertion between visible runs before committing`, async () => {
		const text = `a\nThe qui\nb`
		const projection: MosaicTextRangeProjection = {
			...projected(text, 0),
			segments: [
				{
					end: text.length,
					fragments: [
						{ runId: `base`, start: 0, text: `a\n` },
						{ runId: `typed`, start: 0, text: `The qui` },
						{ runId: `base`, start: 2, text: `\nb` },
					],
					id: `leaf:0`,
					start: 0,
					text,
				},
			],
		}
		let view: MosaicTextEditorView<Peer> | null = null
		let replacement: {
			readonly selection: MosaicTextSelection
			readonly text: string
		} | null = null
		const positionReads: number[] = []
		const client = {
			positionAtOffset(offset: number) {
				positionReads.push(offset)
				return Promise.resolve({
					affinity: `right` as const,
					offset,
					runId: `base`,
				})
			},
			readLength: () => Promise.resolve(10),
			resolvePosition: () => Promise.resolve(0),
		} satisfies Pick<
			MosaicTextProjectionClient,
			`positionAtOffset` | `readLength` | `resolvePosition`
		>
		const Probe = (): ReactElement => {
			view = useMosaicTextEditor({
				client,
				commitDelayMs: 1,
				connected: true,
				documentLength: projection.text.length,
				peers: [],
				projection,
				publishSelection: () => undefined,
				replace(input) {
					replacement = input
					return Promise.resolve()
				},
			})
			return <output>{view.text}</output>
		}
		const rendered = render(<Probe />)
		await waitFor(() => {
			expect(view?.projection).not.toBeNull()
		})
		act(() => {
			view?.onDirty()
			view?.onValueChange(`a\nThe quic\nb`, false)
		})
		await waitFor(() => {
			expect(replacement).not.toBeNull()
		})
		expect(positionReads).toEqual([])
		expect(replacement).toMatchObject({
			selection: {
				anchor: { affinity: `left`, offset: 7, runId: `typed` },
				head: { affinity: `right`, offset: 2, runId: `base` },
			},
			text: `c`,
		})
		rendered.unmount()
	})

	test(`owns optimistic settlement, logical selections, and remote projection`, async () => {
		let projection = projected(`Add rollout owners`, 0)
		let length = projection.text.length
		let view: MosaicTextEditorView<Peer> | null = null
		const replacements: Array<{
			readonly selection: MosaicTextSelection
			readonly text: string
		}> = []
		const published: MosaicTextSelection[] = []
		const first = deferred()
		const second = deferred()
		const third = deferred()
		const fourth = deferred()
		const pending = [first, second, third, fourth]
		const client = {
			positionAtOffset: (offset: number) =>
				Promise.resolve({
					affinity: `right` as const,
					offset,
					runId: `base`,
				}),
			readLength: () => Promise.resolve(length),
			resolvePosition: (position: { readonly offset: number }) =>
				Promise.resolve(
					length > 18 ? position.offset + `careful `.length : position.offset,
				),
		} as Pick<
			MosaicTextProjectionClient,
			`positionAtOffset` | `readLength` | `resolvePosition`
		>
		const peerSelection = {
			anchor: { affinity: `right`, offset: 10, runId: `base` },
			head: { affinity: `right`, offset: 10, runId: `base` },
		} satisfies MosaicTextSelection
		const peers = [
			{ id: `lin`, selection: peerSelection, value: { name: `Lin` } },
		] as const
		const Probe = (): ReactElement => {
			view = useMosaicTextEditor({
				client,
				commitDelayMs: 1,
				connected: true,
				documentLength: length,
				onDocumentLength: (next) => {
					length = next
				},
				peers,
				projection,
				publishSelection(selection) {
					published.push(selection)
				},
				replace(input) {
					replacements.push(input)
					return pending[replacements.length - 1].promise
				},
			})
			return <output>{view.text}</output>
		}
		const rendered = render(<Probe />)
		await waitFor(() => {
			expect(view?.text).toBe(`Add rollout owners`)
		})
		await waitFor(() => {
			expect(view?.remoteSelections).toMatchObject([
				{ end: 10, id: `lin`, start: 10, value: { name: `Lin` } },
			])
		})

		act(() => view?.onDirty())
		act(() => view?.onValueChange(`Add rollout ow`, false))
		act(() => view?.onSelectionChange(14, 14))
		await waitFor(() => {
			expect(replacements).toHaveLength(1)
		})
		expect((view as unknown as MosaicTextEditorView<Peer>).hasLocalDraft).toBe(
			true,
		)
		expect(replacements[0]).toMatchObject({
			selection: { anchor: { offset: 14 }, head: { offset: 18 } },
			text: ``,
		})

		act(() => view?.onValueChange(`Add rollout owners`, false))
		act(() => view?.onSelectionChange(18, 18))
		length = 14
		projection = projected(`Add rollout ow`, 1)
		rendered.rerender(<Probe />)
		first.resolve()
		await waitFor(() => {
			expect(replacements).toHaveLength(2)
		})
		expect(replacements[1]).toMatchObject({
			selection: { anchor: { offset: 14 }, head: { offset: 14 } },
			text: `ners`,
		})

		length = 18
		projection = projected(`Add rollout owners`, 2)
		rendered.rerender(<Probe />)
		second.resolve()
		await waitFor(() => {
			expect(view?.hasLocalDraft).toBe(false)
		})
		await waitFor(() => {
			expect(view?.selection).toEqual([18, 18])
		})
		await waitFor(() => {
			expect(published).toHaveLength(1)
		})

		const inserted = `Add careful rollout owners`
		act(() => view?.onValueChange(inserted, false))
		await waitFor(() => {
			expect(replacements).toHaveLength(3)
		})
		await waitFor(() => {
			expect(view?.remoteSelections).toMatchObject([
				{ end: 18, id: `lin`, start: 18 },
			])
		})
		length = inserted.length
		projection = projected(inserted.slice(0, 18), 3, {
			complete: false,
			rangeEnd: inserted.length,
			runId: `stale`,
		})
		rendered.rerender(<Probe />)
		third.resolve()
		await waitFor(() => {
			expect(view?.text).toBe(inserted)
		})
		act(() => view?.onValueChange(`${inserted}!`, false))
		await new Promise((resolve) => setTimeout(resolve, 20))
		expect(replacements).toHaveLength(3)

		projection = projected(inserted, 3)
		rendered.rerender(<Probe />)
		await waitFor(() => {
			expect(replacements).toHaveLength(4)
		})
		length = inserted.length + 1
		projection = projected(`${inserted}!`, 4)
		rendered.rerender(<Probe />)
		fourth.resolve()
		await waitFor(() => {
			expect(view?.text).toBe(`${inserted}!`)
		})
		await waitFor(() => {
			expect(view?.hasLocalDraft).toBe(false)
		})
		rendered.unmount()
	})

	test(`carries unchanged remote selections across transitional draft cuts`, async () => {
		const canonical = `alpha rollout omega`
		const rollout = canonical.indexOf(`rollout`)
		const draft = `++${canonical}`
		let projection = projected(canonical, 0, { runId: `base` })
		let view: MosaicTextEditorView<Peer> | null = null
		let peerName = `Lin`
		let logicalSelection = {
			anchor: { affinity: `left` as const, offset: rollout, runId: `base` },
			head: { affinity: `left` as const, offset: rollout, runId: `base` },
		}
		const client = {
			positionAtOffset: () => Promise.reject(new Error(`unused`)),
			readLength: () => Promise.resolve(draft.length),
			resolvePosition: () => Promise.resolve(rollout),
		} satisfies Pick<
			MosaicTextProjectionClient,
			`positionAtOffset` | `readLength` | `resolvePosition`
		>
		const Probe = (): ReactElement => {
			view = useMosaicTextEditor({
				client,
				commitDelayMs: 10_000,
				connected: false,
				documentLength: canonical.length,
				peers: [
					{
						id: `lin`,
						selection: logicalSelection,
						value: { name: peerName },
					},
				],
				projection,
				publishSelection: () => undefined,
				replace: () => Promise.resolve(),
			})
			return <output>{view.text}</output>
		}
		const rendered = render(<Probe />)
		await waitFor(() => {
			expect(view?.remoteSelections).toMatchObject([
				{ end: rollout, id: `lin`, start: rollout },
			])
		})

		act(() => {
			view?.onDirty()
			view?.onValueChange(draft, false)
		})
		expect((view as unknown as MosaicTextEditorView<Peer>).text).toBe(draft)
		expect(
			(view as unknown as MosaicTextEditorView<Peer>).remoteSelections,
		).toMatchObject([{ end: rollout + 2, id: `lin`, start: rollout + 2 }])

		const transitional = `+${canonical.slice(0, rollout)}`
		projection = {
			...projected(transitional, 1),
			range: { end: draft.length, kind: `utf16-range`, start: 0 },
			segments: [
				{
					end: transitional.length,
					fragments: [
						{ runId: `prefix`, start: 0, text: `+` },
						{
							runId: `base`,
							start: 0,
							text: canonical.slice(0, rollout),
						},
					],
					id: `leaf:transition`,
					start: 0,
					text: transitional,
				},
			],
		}
		peerName = `Lin updated`
		act(() => {
			rendered.rerender(<Probe />)
		})
		expect((view as unknown as MosaicTextEditorView<Peer>).text).toBe(draft)
		expect(
			(view as unknown as MosaicTextEditorView<Peer>).remoteSelections,
		).toMatchObject([{ end: rollout + 2, id: `lin`, start: rollout + 2 }])
		expect(
			(view as unknown as MosaicTextEditorView<Peer>).remoteSelections[0]?.end,
		).not.toBe(draft.length)
		expect(
			(view as unknown as MosaicTextEditorView<Peer>).remoteSelections[0]?.value,
		).toEqual({ name: `Lin updated` })

		logicalSelection = {
			anchor: { affinity: `left`, offset: 1, runId: `future` },
			head: { affinity: `left`, offset: 1, runId: `future` },
		}
		act(() => {
			rendered.rerender(<Probe />)
		})
		expect(
			(view as unknown as MosaicTextEditorView<Peer>).remoteSelections,
		).toMatchObject([{ end: rollout + 2, id: `lin`, start: rollout + 2 }])
		rendered.unmount()
	})

	test(`uses the canonical empty position and retains peers through bad cuts`, async () => {
		let projection = projected(``, 0)
		let view: MosaicTextEditorView<Peer> | null = null
		let remoteReads = 0
		let published: MosaicTextSelection | null = null
		let replacement: {
			readonly selection: MosaicTextSelection
			readonly text: string
		} | null = null
		let length = 0
		const peers: readonly [] = []
		const client = {
			positionAtOffset: () => {
				remoteReads++
				return Promise.reject(new Error(`empty positions are resident`))
			},
			readLength: () => Promise.resolve(length),
			resolvePosition: () => Promise.resolve(0),
		} as unknown as Pick<
			MosaicTextProjectionClient,
			`positionAtOffset` | `readLength` | `resolvePosition`
		>
		const Probe = (): ReactElement => {
			view = useMosaicTextEditor({
				client,
				commitDelayMs: 1,
				connected: true,
				documentLength: length,
				peers,
				projection,
				publishSelection(selection) {
					published = selection
				},
				replace(input) {
					replacement = input
					length = input.text.length
					return Promise.resolve()
				},
			})
			return <output>{view.text}</output>
		}
		const rendered = render(<Probe />)
		await waitFor(() => {
			expect(view?.projection).not.toBeNull()
		})
		act(() => view?.onSelectionChange(0, 0))
		await waitFor(() => {
			expect(published).not.toBeNull()
		})
		expect(published).toEqual({
			anchor: { affinity: `left`, offset: 0, runId: null },
			head: { affinity: `left`, offset: 0, runId: null },
		})
		expect(remoteReads).toBe(0)
		act(() => view?.onDirty())
		act(() => view?.onValueChange(`[reset]`, false))
		await waitFor(() => {
			expect(replacement).not.toBeNull()
		})
		expect(replacement).toMatchObject({
			selection: {
				anchor: { runId: null },
				head: { runId: null },
			},
			text: `[reset]`,
		})
		projection = projected(`[reset]`, 1, { runId: `reset` })
		rendered.rerender(<Probe />)
		await waitFor(() => {
			expect(view?.text).toBe(`[reset]`)
		})
		rendered.unmount()
	})

	test(`reports a failed commit without discarding the optimistic draft`, async () => {
		let view: MosaicTextEditorView<Peer> | null = null
		const failure = new Error(`transport unavailable`)
		const errors: unknown[] = []
		const peers: readonly [] = []
		const projection = projected(`alpha`, 0)
		const client = {
			positionAtOffset: (offset: number) =>
				Promise.resolve({
					affinity: `right` as const,
					offset,
					runId: `base`,
				}),
			readLength: () => Promise.resolve(5),
			resolvePosition: () => Promise.resolve(0),
		} as Pick<
			MosaicTextProjectionClient,
			`positionAtOffset` | `readLength` | `resolvePosition`
		>
		const Probe = (): ReactElement => {
			view = useMosaicTextEditor({
				client,
				commitDelayMs: 1,
				connected: true,
				documentLength: 5,
				onError(error) {
					errors.push(error)
				},
				peers,
				projection,
				publishSelection: () => undefined,
				replace: () => Promise.reject(failure),
			})
			return <output>{view.text}</output>
		}
		const rendered = render(<Probe />)
		await waitFor(() => {
			expect(view?.text).toBe(`alpha`)
		})
		act(() => view?.onValueChange(`alpha!`, false))
		await waitFor(() => {
			expect(errors).toEqual([failure])
		})
		const failedView = view as unknown as MosaicTextEditorView<Peer>
		expect(failedView.text).toBe(`alpha!`)
		expect(failedView.hasLocalDraft).toBe(true)
		rendered.unmount()
	})

	test(`reprojects a local logical selection through resident and resolved cuts`, async () => {
		let projection = projected(`abcdef`, 0)
		let view: MosaicTextEditorView<Peer> | null = null
		const published: MosaicTextSelection[] = []
		const peers: readonly [] = []
		let resolvedOffset = 4
		const client = {
			positionAtOffset: (offset: number) =>
				Promise.resolve({ affinity: `left` as const, offset, runId: `base` }),
			readLength: () => Promise.resolve(projection.text.length),
			resolvePosition: () => Promise.resolve(resolvedOffset),
		} as Pick<
			MosaicTextProjectionClient,
			`positionAtOffset` | `readLength` | `resolvePosition`
		>
		const Probe = (): ReactElement => {
			view = useMosaicTextEditor({
				client,
				connected: true,
				documentLength: projection.text.length,
				peers,
				projection,
				publishSelection(selection) {
					published.push(selection)
				},
				replace: () => Promise.resolve(),
			})
			return <output>{view.text}</output>
		}
		const rendered = render(<Probe />)
		await waitFor(() => {
			expect(view?.projection).not.toBeNull()
		})
		act(() => view?.onSelectionChange(3, 3))
		await waitFor(() => {
			expect(published).toHaveLength(1)
		})

		projection = {
			...projected(`++abcdef`, 1),
			segments: [
				{
					end: 8,
					fragments: [
						{ runId: `prefix`, start: 0, text: `++` },
						{ runId: `base`, start: 0, text: `abcdef` },
					],
					id: `leaf:1`,
					start: 0,
					text: `++abcdef`,
				},
			],
		}
		rendered.rerender(<Probe />)
		await waitFor(() => {
			expect(view?.selection).toEqual([5, 5])
		})

		resolvedOffset = 6
		projection = projected(`other text`, 2, { runId: `other` })
		rendered.rerender(<Probe />)
		await waitFor(() => {
			expect(view?.selection).toEqual([6, 6])
		})
		rendered.unmount()
	})

	test(`keeps the local selection stable through stale and boundary resolutions`, async () => {
		let projection = projected(`abcdef`, 0)
		let view: MosaicTextEditorView<Peer> | null = null
		let resolved: number | Promise<number> = 3
		let resolveStale = (_offset: number): void => undefined
		let resolutionReads = 0
		const published: MosaicTextSelection[] = []
		const client = {
			positionAtOffset: (offset: number) =>
				Promise.resolve({ affinity: `left` as const, offset, runId: `base` }),
			readLength: () => Promise.resolve(projection.text.length),
			resolvePosition: () => {
				resolutionReads++
				return Promise.resolve(resolved)
			},
		} satisfies Pick<
			MosaicTextProjectionClient,
			`positionAtOffset` | `readLength` | `resolvePosition`
		>
		const Probe = (): ReactElement => {
			view = useMosaicTextEditor({
				client,
				connected: true,
				documentLength: 10,
				peers: [],
				projection,
				publishSelection(selection) {
					published.push(selection)
				},
				replace: () => Promise.resolve(),
			})
			return <output>{view.text}</output>
		}
		const rendered = render(<Probe />)
		await waitFor(() => {
			expect(view?.projection).not.toBeNull()
		})
		act(() => view?.onSelectionChange(3, 3))
		await waitFor(() => {
			expect(published).toHaveLength(1)
		})

		resolved = new Promise<number>((resolve) => {
			resolveStale = resolve
		})
		projection = projected(`ABCDEF`, 1, { runId: `other` })
		rendered.rerender(<Probe />)
		await waitFor(() => {
			expect(resolutionReads).toBe(2)
		})

		resolved = 0
		projection = projected(`ABCDEF`, 2, { runId: `other` })
		rendered.rerender(<Probe />)
		resolveStale(4)
		await waitFor(() => {
			expect(resolutionReads).toBe(4)
		})
		expect(
			(view as unknown as MosaicTextEditorView<Peer>).projection?.revision,
		).toBe(0)

		resolved = 7
		projection = projected(`ABCDEF`, 3, {
			rangeEnd: 10,
			runId: `other`,
		})
		rendered.rerender(<Probe />)
		await waitFor(() => {
			expect(resolutionReads).toBe(6)
		})
		expect(
			(view as unknown as MosaicTextEditorView<Peer>).projection?.revision,
		).toBe(0)

		resolved = 4
		projection = projected(`ABCDEF`, 4, { runId: `other` })
		rendered.rerender(<Probe />)
		await waitFor(() => {
			expect(view?.selection).toEqual([4, 4])
		})
		rendered.unmount()
	})

	test(`does not publish a delayed selection after a newer selection supersedes it`, async () => {
		const projection = projected(`alpha`, 0, { rangeEnd: 10 })
		let view: MosaicTextEditorView<Peer> | null = null
		let resolvePositionRead: (() => void) | null = null
		const positionRead = new Promise<void>((resolve) => {
			resolvePositionRead = resolve
		})
		let positionReads = 0
		const published: MosaicTextSelection[] = []
		const client = {
			positionAtOffset: async (offset: number) => {
				positionReads++
				await positionRead
				return { affinity: `left` as const, offset, runId: `base` }
			},
			readLength: () => Promise.resolve(6),
			resolvePosition: () => Promise.resolve(0),
		} satisfies Pick<
			MosaicTextProjectionClient,
			`positionAtOffset` | `readLength` | `resolvePosition`
		>
		const Probe = (): ReactElement => {
			view = useMosaicTextEditor({
				client,
				commitDelayMs: 10_000,
				connected: true,
				documentLength: 10,
				peers: [],
				projection,
				publishSelection(selection) {
					published.push(selection)
				},
				replace: () => Promise.resolve(),
			})
			return <output>{view.text}</output>
		}
		const rendered = render(<Probe />)
		await waitFor(() => {
			expect(view?.projection).not.toBeNull()
		})
		act(() => {
			view?.onSelectionChange(8, 8)
		})
		expect(positionReads).toBe(2)
		act(() => {
			view?.onSelectionChange(1, 1)
			view?.onSelectionChange(1, 1)
		})
		await waitFor(() => {
			expect(published).toHaveLength(1)
		})
		act(() => {
			resolvePositionRead?.()
		})
		await Promise.resolve()
		expect(published).toHaveLength(1)
		expect(published[0]).toMatchObject({
			anchor: { offset: 1 },
			head: { offset: 1 },
		})
		rendered.unmount()
	})

	test(`queues a composing offline draft and settles a legacy projection`, async () => {
		const first = projected(`alpha`, 0)
		delete (first as { revision?: number }).revision
		let projection = first
		let connected = false
		let view: MosaicTextEditorView<Peer> | null = null
		let replacements = 0
		const errors: unknown[] = []
		const peers: readonly [] = []
		const client = {
			positionAtOffset: (offset: number) =>
				Promise.resolve({ affinity: `left` as const, offset, runId: `base` }),
			readLength: () => Promise.reject(new Error(`length unavailable`)),
			resolvePosition: () => Promise.resolve(0),
		} as Pick<
			MosaicTextProjectionClient,
			`positionAtOffset` | `readLength` | `resolvePosition`
		>
		const Probe = (): ReactElement => {
			view = useMosaicTextEditor({
				client,
				commitDelayMs: 1,
				connected,
				documentLength: 5,
				onError(error) {
					errors.push(error)
				},
				peers,
				projection,
				publishSelection: () => undefined,
				replace() {
					replacements++
					return Promise.resolve()
				},
			})
			return <output>{view.text}</output>
		}
		const rendered = render(<Probe />)
		await waitFor(() => {
			expect(view?.text).toBe(`alpha`)
		})
		act(() => view?.onValueChange(`alpha!`, true))
		await new Promise((resolve) => setTimeout(resolve, 10))
		expect(replacements).toBe(0)
		act(() => view?.onValueChange(`alpha!`, false))
		await new Promise((resolve) => setTimeout(resolve, 10))
		expect(replacements).toBe(0)

		connected = true
		rendered.rerender(<Probe />)
		await waitFor(() => {
			expect(replacements).toBe(1)
		})
		await waitFor(() => {
			expect(errors).toHaveLength(1)
		})
		const next = projected(`alpha!`, 1)
		delete (next as { revision?: number }).revision
		projection = next
		rendered.rerender(<Probe />)
		await waitFor(() => {
			expect(view?.hasLocalDraft).toBe(false)
		})
		act(() => view?.onDirty())
		act(() => view?.onValueChange(`alpha!`, false))
		await waitFor(() => {
			expect(view?.hasLocalDraft).toBe(false)
		})
		act(() => view?.onValueChange(`alpha?`, false))
		act(() => view?.onValueChange(`alpha!`, false))
		await waitFor(() => {
			expect(view?.hasLocalDraft).toBe(false)
		})
		expect(replacements).toBe(1)
		rendered.unmount()
	})

	test(`retains remote selections through boundary cuts and filters peers`, async () => {
		let projection = projected(`abcdef`, 0, { runId: `resident` })
		let peers: readonly MosaicTextEditorPeer<Peer>[] = [
			{
				id: `lin`,
				selection: {
					anchor: { affinity: `left`, offset: 2, runId: `missing` },
					head: { affinity: `left`, offset: 2, runId: `missing` },
				},
				value: { name: `Lin` },
			},
		]
		let resolved = 2
		let view: MosaicTextEditorView<Peer> | null = null
		const client = {
			positionAtOffset: () => Promise.reject(new Error(`unused`)),
			readLength: () => Promise.resolve(6),
			resolvePosition: () => Promise.resolve(resolved),
		} as Pick<
			MosaicTextProjectionClient,
			`positionAtOffset` | `readLength` | `resolvePosition`
		>
		const Probe = (): ReactElement => {
			view = useMosaicTextEditor({
				client,
				connected: true,
				documentLength: 6,
				peers,
				projection,
				publishSelection: () => undefined,
				replace: () => Promise.resolve(),
			})
			return <output>{view.text}</output>
		}
		const rendered = render(<Probe />)
		await waitFor(() => {
			expect(view?.remoteSelections).toMatchObject([
				{ end: 2, id: `lin`, start: 2 },
			])
		})

		resolved = 0
		projection = projected(`ABCDEF`, 1, { runId: `other` })
		rendered.rerender(<Probe />)
		await new Promise((resolve) => setTimeout(resolve, 10))
		expect(
			(view as unknown as MosaicTextEditorView<Peer>).remoteSelections,
		).toHaveLength(1)

		resolved = -1
		peers = [
			{
				...peers[0],
				selection: {
					anchor: { affinity: `left`, offset: 3, runId: `missing` },
					head: { affinity: `left`, offset: 3, runId: `missing` },
				},
			},
			{ id: `grace`, selection: null, value: { name: `Grace` } },
		]
		rendered.rerender(<Probe />)
		await waitFor(() => {
			expect(view?.remoteSelections).toEqual([])
		})

		resolved = 7
		projection = {
			...projected(`ABCDEF`, 2, { rangeEnd: 10, runId: `other` }),
			complete: true,
		}
		peers = [
			{
				...peers[0],
				selection: {
					anchor: { affinity: `left`, offset: 4, runId: `missing` },
					head: { affinity: `left`, offset: 4, runId: `missing` },
				},
			},
		]
		rendered.rerender(<Probe />)
		await new Promise((resolve) => setTimeout(resolve, 10))
		expect(
			(view as unknown as MosaicTextEditorView<Peer>).remoteSelections,
		).toEqual([])
		rendered.unmount()
	})

	test(`never collapses a future collaborator position onto the displayed end`, async () => {
		let projection = projected(`abcdef`, 0)
		let peers: readonly MosaicTextEditorPeer<Peer>[] = [
			{
				id: `lin`,
				selection: {
					anchor: { affinity: `left`, offset: 2, runId: `base` },
					head: { affinity: `left`, offset: 2, runId: `base` },
				},
				value: { name: `Lin` },
			},
		]
		let resolveFuture: ((offset: number) => void) | null = null
		const future = new Promise<number>((resolve) => {
			resolveFuture = resolve
		})
		let view: MosaicTextEditorView<Peer> | null = null
		const client = {
			positionAtOffset: () => Promise.reject(new Error(`unused`)),
			readLength: () => Promise.resolve(projection.text.length),
			resolvePosition: () => future,
		} as Pick<
			MosaicTextProjectionClient,
			`positionAtOffset` | `readLength` | `resolvePosition`
		>
		const Probe = (): ReactElement => {
			view = useMosaicTextEditor({
				client,
				connected: true,
				documentLength: projection.text.length,
				peers,
				projection,
				publishSelection: () => undefined,
				replace: () => Promise.resolve(),
			})
			return <output>{view.text}</output>
		}
		const rendered = render(<Probe />)
		await waitFor(() => {
			expect(view?.remoteSelections).toMatchObject([
				{ end: 2, id: `lin`, start: 2 },
			])
		})

		projection = {
			...projected(`++abcdef`, 1),
			segments: [
				{
					end: 8,
					fragments: [
						{ runId: `prefix`, start: 0, text: `++` },
						{ runId: `base`, start: 0, text: `abcdef` },
					],
					id: `leaf:1`,
					start: 0,
					text: `++abcdef`,
				},
			],
		}
		peers = [
			{
				...peers[0],
				selection: {
					anchor: { affinity: `left`, offset: 2, runId: `future` },
					head: { affinity: `left`, offset: 2, runId: `future` },
				},
			},
		]
		rendered.rerender(<Probe />)
		await waitFor(() => {
			expect(view?.text).toBe(`++abcdef`)
		})
		expect(
			(view as unknown as MosaicTextEditorView<Peer>).remoteSelections,
		).toMatchObject([{ end: 4, id: `lin`, start: 4 }])

		act(() => resolveFuture?.(8))
		await new Promise((resolve) => setTimeout(resolve, 10))
		expect(
			(view as unknown as MosaicTextEditorView<Peer>).remoteSelections,
		).toMatchObject([{ end: 4, id: `lin`, start: 4 }])

		projection = {
			...projection,
			revision: 2,
			segments: [
				{
					end: 8,
					fragments: [
						{ runId: `prefix`, start: 0, text: `++` },
						{ runId: `future`, start: 0, text: `abcdef` },
					],
					id: `leaf:2`,
					start: 0,
					text: `++abcdef`,
				},
			],
		}
		rendered.rerender(<Probe />)
		await waitFor(() => {
			expect(view?.remoteSelections).toMatchObject([
				{ end: 4, id: `lin`, start: 4 },
			])
		})
		rendered.unmount()
	})

	test(`maps resident peer positions before diffing bounded projection cuts`, async () => {
		const before = `abc rollout owners tail\n`
		const insertion = before.indexOf(`rollout`)
		let projection = projected(before, 0, { runId: `base` })
		let peers: readonly MosaicTextEditorPeer<Peer>[] = [
			{
				id: `lin`,
				selection: {
					anchor: { affinity: `left`, offset: insertion, runId: `base` },
					head: { affinity: `left`, offset: insertion, runId: `base` },
				},
				value: { name: `Lin` },
			},
		]
		let view: MosaicTextEditorView<Peer> | null = null
		const client = {
			positionAtOffset: () => Promise.reject(new Error(`unused`)),
			readLength: () => Promise.resolve(before.length + 1),
			resolvePosition: () => new Promise<number>(() => undefined),
		} as Pick<
			MosaicTextProjectionClient,
			`positionAtOffset` | `readLength` | `resolvePosition`
		>
		const Probe = (): ReactElement => {
			view = useMosaicTextEditor({
				client,
				connected: true,
				documentLength: before.length,
				peers,
				projection,
				publishSelection: () => undefined,
				replace: () => Promise.resolve(),
			})
			return <output>{view.text}</output>
		}
		const rendered = render(<Probe />)
		await waitFor(() => {
			expect(view?.remoteSelections).toMatchObject([
				{ end: insertion, id: `lin`, start: insertion },
			])
		})

		const after = `${before.slice(0, insertion)}[${before.slice(insertion, -1)}`
		projection = {
			...projected(after, 1),
			segments: [
				{
					end: after.length,
					fragments: [
						{
							runId: `base`,
							start: 0,
							text: before.slice(0, insertion),
						},
						{ runId: `insert`, start: 0, text: `[` },
						{
							runId: `base`,
							start: insertion,
							text: before.slice(insertion, -1),
						},
					],
					id: `leaf:1`,
					start: 0,
					text: after,
				},
			],
		}
		peers = [
			{
				...peers[0],
				selection: {
					anchor: { affinity: `left`, offset: 1, runId: `insert` },
					head: { affinity: `left`, offset: 1, runId: `insert` },
				},
			},
		]
		act(() => {
			rendered.rerender(<Probe />)
		})
		expect(
			(view as unknown as MosaicTextEditorView<Peer>).remoteSelections,
		).toMatchObject([{ end: insertion + 1, id: `lin`, start: insertion + 1 }])
		expect(
			(view as unknown as MosaicTextEditorView<Peer>).remoteSelections[0]?.end,
		).not.toBe(after.length)
		rendered.unmount()
	})
})
