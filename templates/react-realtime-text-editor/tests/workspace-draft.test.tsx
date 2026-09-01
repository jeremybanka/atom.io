import { render, waitFor } from "@testing-library/react"
import type * as RealtimeReact from "atom.io/realtime-react"
import { act, createElement } from "react"
import { vi } from "vitest"

import type { MarkdownCollaborationClient } from "../src/collaboration-client.ts"
import type { RenderedCollaboratorSelection } from "../src/LexicalMarkdownEditor.tsx"

type EditorProperties = {
	readonly onDirty: () => void
	readonly onSelectionChange: (anchor: number, head: number) => void
	readonly onValueChange: (value: string, composing: boolean) => void
	readonly selection: readonly [number, number] | null
	readonly selections: readonly RenderedCollaboratorSelection[]
	readonly value: string
}

const harness = vi.hoisted(() => ({
	editor: null as EditorProperties | null,
	length: 18,
	presence: [
		{
			address: { member: `collaborator` },
			kind: `update`,
			value: {
				actor: `lin`,
				color: `#f00`,
				name: `Lin`,
				selection: {
					anchor: { affinity: `right`, offset: 10, runId: `base` },
					head: { affinity: `right`, offset: 10, runId: `base` },
				},
				session: `lin-session`,
				viewport: null,
			},
		},
	],
	projection: {
		blocks: [],
		complete: true,
		range: { end: 18, kind: `utf16-range` as const, start: 0 },
		revision: 0,
		segments: [
			{
				end: 18,
				fragments: [{ runId: `base`, start: 0, text: `Add rollout owners` }],
				id: `leaf`,
				start: 0,
				text: `Add rollout owners`,
			},
		],
		text: `Add rollout owners`,
	},
}))

vi.mock(`atom.io/realtime-react`, async (importOriginal) => ({
	...(await importOriginal<typeof RealtimeReact>()),
	useMosaicTextRange: () => ({
		error: null,
		projection: harness.projection,
		status: `ready`,
	}),
}))

vi.mock(`../src/LexicalMarkdownEditor.tsx`, () => ({
	LexicalMarkdownEditor: (properties: EditorProperties) => {
		harness.editor = properties
		return createElement(`div`, { role: `textbox` }, properties.value)
	},
}))

const deferred = () => {
	let resolve = (): void => undefined
	const promise = new Promise<void>((complete) => {
		resolve = complete
	})
	return { promise, resolve }
}

const projection = (
	text: string,
	rangeEnd = text.length,
	fragments = [{ runId: `base`, start: 0, text }],
	revision = 0,
) => ({
	blocks: [],
	complete: text.length === rangeEnd,
	range: { end: rangeEnd, kind: `utf16-range` as const, start: 0 },
	revision,
	segments: [
		{
			end: text.length,
			fragments,
			id: `leaf`,
			start: 0,
			text,
		},
	],
	text,
})

describe(`Markdown workspace drafts`, () => {
	test(`rebases queued typing without exposing an incomplete resident tail`, async () => {
		const first = deferred()
		const second = deferred()
		const third = deferred()
		const fourth = deferred()
		harness.length = 18
		harness.projection = projection(`Add rollout owners`)
		const replacements: Array<{
			readonly selection: {
				readonly anchor: { readonly offset: number }
				readonly head: { readonly offset: number }
			}
			readonly text: string
		}> = []
		const publishedPresence: Array<{
			readonly selection: null | {
				readonly anchor: { readonly offset: number }
				readonly head: { readonly offset: number }
			}
		}> = []
		const status = {
			connection: `live` as const,
			pending: 0,
			reason: null,
		}
		const client = {
			history: {},
			identity: { color: `#000`, id: `ada`, name: `Ada` },
			presence: {
				state: { presence: harness.presence },
				subscribe: () => () => undefined,
			},
			projection: {
				positionAtOffset: (offset: number) =>
					Promise.resolve({
						affinity: `right` as const,
						offset,
						runId: `base`,
					}),
				readLength: () => Promise.resolve(harness.length),
				resolvePosition: (position: {
					readonly offset: number
					readonly runId?: string
				}) =>
					Promise.resolve(
						harness.length > 18
							? position.offset + `careful `.length
							: position.offset,
					),
			},
			publishPresence: (presence: (typeof publishedPresence)[number]) => {
				publishedPresence.push(presence)
				return Promise.resolve()
			},
			redo: () => Promise.resolve(false),
			replace: (input: (typeof replacements)[number]) => {
				replacements.push(input)
				return [first, second, third, fourth][replacements.length - 1]?.promise
			},
			residency: { state: { residentMemberCount: 2 } },
			sessionId: `ada-session`,
			status: () => status,
			subscribe: (listener: (next: typeof status) => void) => {
				listener(status)
				return () => undefined
			},
			undo: () => Promise.resolve(false),
		} as unknown as MarkdownCollaborationClient
		const { MarkdownWorkspace } = await import(`../src/MarkdownWorkspace.tsx`)
		const rendered = render(<MarkdownWorkspace client={client} />)
		await waitFor(() => {
			expect(harness.editor?.value).toBe(`Add rollout owners`)
		})
		expect(rendered.getAllByText(`All changes saved`)).toHaveLength(2)
		await waitFor(() => {
			expect(harness.editor?.selections).toMatchObject([
				{ end: 10, name: `Lin`, start: 10 },
			])
		})

		act(() => harness.editor?.onDirty())
		expect(rendered.getAllByText(`Saving 1 gesture…`)).toHaveLength(2)
		act(() => harness.editor?.onValueChange(`Add rollout ow`, false))
		expect(rendered.getAllByText(`Saving 1 gesture…`)).toHaveLength(2)
		act(() => harness.editor?.onSelectionChange(14, 14))
		await waitFor(() => {
			expect(replacements).toHaveLength(1)
		})
		expect(replacements[0]).toMatchObject({
			selection: { anchor: { offset: 14 }, head: { offset: 18 } },
			text: ``,
		})

		act(() => harness.editor?.onValueChange(`Add rollout owners`, false))
		act(() => harness.editor?.onSelectionChange(18, 18))
		expect(
			publishedPresence.filter((presence) => presence.selection !== null),
		).toHaveLength(0)
		harness.projection = projection(`Add rollout ow`, 14, undefined, 1)
		harness.length = 14
		rendered.rerender(<MarkdownWorkspace client={client} />)
		first.resolve()

		await waitFor(() => {
			expect(replacements).toHaveLength(2)
		})
		expect(replacements[1]).toMatchObject({
			selection: { anchor: { offset: 14 }, head: { offset: 14 } },
			text: `ners`,
		})
		harness.projection = projection(`Add rollout owners`, 18, undefined, 2)
		harness.length = 18
		rendered.rerender(<MarkdownWorkspace client={client} />)
		second.resolve()
		await waitFor(() => {
			expect(harness.editor?.value).toBe(`Add rollout owners`)
		})
		await waitFor(() => {
			expect(harness.editor?.selection).toEqual([18, 18])
		})
		await waitFor(() => {
			expect(
				publishedPresence.filter((presence) => presence.selection !== null),
			).toMatchObject([
				{
					selection: {
						anchor: { offset: 18 },
						head: { offset: 18 },
					},
				},
			])
		})

		const inserted = `Add careful rollout owners`
		act(() => harness.editor?.onValueChange(inserted, false))
		await waitFor(() => {
			expect(harness.editor?.selections).toMatchObject([
				{ end: 18, name: `Lin`, start: 18 },
			])
		})
		await waitFor(() => {
			expect(replacements).toHaveLength(3)
		})
		expect(replacements[2]).toMatchObject({
			selection: { anchor: { offset: 4 }, head: { offset: 4 } },
			text: `careful `,
		})
		// The accepted operation advances the authoritative document length before
		// residency has replaced the old-length viewport. Keep the complete local
		// draft visible rather than exposing a projection that eats its tail.
		harness.length = inserted.length
		// A newly acquired observer can already advertise the requested range while
		// its resident leaf still contains the prior, shorter value.
		harness.projection = projection(
			inserted.slice(0, 18),
			inserted.length,
			[{ runId: `stale`, start: 0, text: inserted.slice(0, 18) }],
			3,
		)
		rendered.rerender(<MarkdownWorkspace client={client} />)
		third.resolve()
		await waitFor(() => {
			expect(harness.editor?.value).toBe(inserted)
		})
		// The previous cursor offsets remain bound to the projection that resolved
		// them until the next logical lookup completes. Never reinterpret them
		// against the accepted text and briefly regress the overlay.
		expect(harness.editor?.selections).toMatchObject([
			{ end: 18, name: `Lin`, start: 18 },
		])
		act(() => harness.editor?.onValueChange(`${inserted}!`, false))
		await new Promise((resolve) => setTimeout(resolve, 200))
		expect(replacements).toHaveLength(3)

		harness.projection = projection(
			inserted,
			inserted.length,
			[
				{ runId: `careful`, start: 0, text: `careful ` },
				{ runId: `base`, start: 0, text: `Add rollout owners` },
			],
			3,
		)
		rendered.rerender(<MarkdownWorkspace client={client} />)
		await waitFor(() => {
			expect(replacements).toHaveLength(4)
		})
		expect(replacements[3]).toMatchObject({
			selection: {
				anchor: { affinity: `left`, offset: 18, runId: `base` },
				head: { affinity: `left`, offset: 18, runId: `base` },
			},
			text: `!`,
		})
		harness.length = inserted.length + 1
		harness.projection = projection(
			`${inserted}!`,
			inserted.length + 1,
			[
				{ runId: `careful`, start: 0, text: `careful ` },
				{ runId: `base`, start: 0, text: `Add rollout owners` },
				{ runId: `bang`, start: 0, text: `!` },
			],
			4,
		)
		rendered.rerender(<MarkdownWorkspace client={client} />)
		fourth.resolve()
		await waitFor(() => {
			expect(harness.editor?.value).toBe(`${inserted}!`)
		})
		await waitFor(() => {
			expect(rendered.getAllByText(`All changes saved`)).toHaveLength(2)
		})
	})
})
