import { render, waitFor } from "@testing-library/react"
import { act, createElement } from "react"
import { vi } from "vitest"

import type { MarkdownCollaborationClient } from "../src/collaboration-client.ts"
import type { RenderedCollaboratorSelection } from "../src/LexicalMarkdownEditor.tsx"

type EditorProperties = {
	readonly onValueChange: (value: string, composing: boolean) => void
	readonly selections: readonly RenderedCollaboratorSelection[]
	readonly value: string
}

const harness = vi.hoisted(() => ({
	editor: null as EditorProperties | null,
	projection: {
		blocks: [],
		range: { end: 18, kind: `utf16-range` as const, start: 0 },
		text: `Add rollout owners`,
	},
}))

vi.mock(`atom.io/realtime-react`, () => ({
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

describe(`Markdown workspace drafts`, () => {
	test(`rebases typing that continues during an accepted edit`, async () => {
		const first = deferred()
		const second = deferred()
		const replacements: Array<{
			readonly selection: {
				readonly anchor: { readonly offset: number }
				readonly head: { readonly offset: number }
			}
			readonly text: string
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
				state: { presence: [] },
				subscribe: () => () => undefined,
			},
			projection: {
				positionAtOffset: async (offset: number) => ({
					affinity: `right` as const,
					offset,
					runId: `base`,
				}),
				readLength: async () => harness.projection.text.length,
				resolvePosition: async (position: { readonly offset: number }) =>
					position.offset,
			},
			publishPresence: async () => undefined,
			redo: async () => false,
			replace: (input: (typeof replacements)[number]) => {
				replacements.push(input)
				return replacements.length === 1 ? first.promise : second.promise
			},
			residency: { state: { residentMemberCount: 2 } },
			sessionId: `ada-session`,
			status: () => status,
			subscribe: (listener: (next: typeof status) => void) => {
				listener(status)
				return () => undefined
			},
			undo: async () => false,
		} as unknown as MarkdownCollaborationClient
		const { MarkdownWorkspace } = await import(`../src/MarkdownWorkspace.tsx`)
		const rendered = render(<MarkdownWorkspace client={client} />)
		await waitFor(() => expect(harness.editor?.value).toBe(`Add rollout owners`))

		act(() => harness.editor?.onValueChange(`Add rollout ow`, false))
		await waitFor(() => expect(replacements).toHaveLength(1))
		expect(replacements[0]).toMatchObject({
			selection: { anchor: { offset: 14 }, head: { offset: 18 } },
			text: ``,
		})

		act(() => harness.editor?.onValueChange(`Add rollout owners`, false))
		harness.projection = {
			...harness.projection,
			range: { end: 14, kind: `utf16-range`, start: 0 },
			text: `Add rollout ow`,
		}
		rendered.rerender(<MarkdownWorkspace client={client} />)
		first.resolve()

		await waitFor(() => expect(replacements).toHaveLength(2))
		expect(replacements[1]).toMatchObject({
			selection: { anchor: { offset: 14 }, head: { offset: 14 } },
			text: `ners`,
		})
		harness.projection = {
			...harness.projection,
			range: { end: 18, kind: `utf16-range`, start: 0 },
			text: `Add rollout owners`,
		}
		rendered.rerender(<MarkdownWorkspace client={client} />)
		second.resolve()
		await waitFor(() => expect(harness.editor?.value).toBe(`Add rollout owners`))
	})
})
