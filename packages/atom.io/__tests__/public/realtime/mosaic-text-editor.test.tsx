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
})
