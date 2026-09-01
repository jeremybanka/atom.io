import type { MosaicTextRelativePosition } from "atom.io/realtime"

export type MarkdownSourceBlock = {
	readonly anchor: MosaicTextRelativePosition
	readonly end: number
	readonly key: string
	readonly start: number
	readonly text: string
}

export type MarkdownSemanticBlock = MarkdownSourceBlock & {
	readonly kind: `blockquote` | `code` | `heading` | `list-item` | `paragraph`
	readonly level?: number
	readonly ordered?: boolean
}

export type MarkdownParseInstrumentation = {
	readonly canceled: boolean
	readonly elapsedMs: number
	readonly parsedBlocks: number
	readonly scannedUtf16Units: number
	readonly stableBoundaryIndex: number | null
	readonly reusedBlocks: number
}

export type MarkdownParseResult = {
	readonly blocks: readonly MarkdownSemanticBlock[]
	readonly instrumentation: MarkdownParseInstrumentation
}

type FenceState = {
	readonly anchor: MosaicTextRelativePosition
	readonly end: number
	readonly key: string
	readonly language: string
	readonly start: number
	readonly text: string
}

type ParseState = { readonly fence: FenceState | null }

type CacheEntry = {
	readonly input: ParseState
	readonly output: ParseState
	readonly semantic: readonly MarkdownSemanticBlock[]
	readonly source: MarkdownSourceBlock
}

const samePosition = (
	left: MosaicTextRelativePosition,
	right: MosaicTextRelativePosition,
): boolean =>
	left.affinity === right.affinity &&
	left.offset === right.offset &&
	left.runId === right.runId

const sameFence = (left: FenceState | null, right: FenceState | null): boolean =>
	left === right ||
	(left !== null &&
		right !== null &&
		left.end === right.end &&
		left.key === right.key &&
		left.language === right.language &&
		left.start === right.start &&
		left.text === right.text &&
		samePosition(left.anchor, right.anchor))

const sameState = (left: ParseState, right: ParseState): boolean =>
	sameFence(left.fence, right.fence)

const sameSource = (
	left: MarkdownSourceBlock,
	right: MarkdownSourceBlock,
): boolean =>
	left.key === right.key &&
	left.start === right.start &&
	left.end === right.end &&
	left.text === right.text &&
	samePosition(left.anchor, right.anchor)

const classify = (source: MarkdownSourceBlock): MarkdownSemanticBlock => {
	const heading = /^(#{1,6})\s+(.*)$/u.exec(source.text)
	if (heading) {
		return {
			...source,
			kind: `heading`,
			level: heading[1].length,
			text: heading[2],
		}
	}
	const ordered = /^\d+[.)]\s+(.*)$/u.exec(source.text)
	if (ordered) {
		return { ...source, kind: `list-item`, ordered: true, text: ordered[1] }
	}
	const unordered = /^[-*+]\s+(.*)$/u.exec(source.text)
	if (unordered) {
		return { ...source, kind: `list-item`, ordered: false, text: unordered[1] }
	}
	if (source.text.startsWith(`> `)) {
		return { ...source, kind: `blockquote`, text: source.text.slice(2) }
	}
	return { ...source, kind: `paragraph` }
}

function parseOne(
	source: MarkdownSourceBlock,
	input: ParseState,
): { readonly output: ParseState; readonly semantic: MarkdownSemanticBlock[] } {
	const fenceMarker = /^```([^\n]*)$/u.exec(source.text.trimEnd())
	if (input.fence === null) {
		if (fenceMarker === null) {
			return {
				output: input,
				semantic: source.text.trim() === `` ? [] : [classify(source)],
			}
		}
		return {
			output: {
				fence: {
					anchor: source.anchor,
					end: source.end,
					key: source.key,
					language: fenceMarker[1].trim(),
					start: source.start,
					text: ``,
				},
			},
			semantic: [],
		}
	}
	if (fenceMarker !== null) {
		return {
			output: { fence: null },
			semantic: [
				{
					anchor: input.fence.anchor,
					end: source.end,
					key: input.fence.key,
					kind: `code`,
					start: input.fence.start,
					text: input.fence.text,
				},
			],
		}
	}
	return {
		output: {
			fence: {
				...input.fence,
				end: source.end,
				text:
					input.fence.text === ``
						? source.text
						: `${input.fence.text}\n${source.text}`,
			},
		},
		semantic: [],
	}
}

const turn = (): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, 0))

/**
 * Incremental block parser with explicit cancelation and stable-boundary reuse.
 * It is renderer-neutral; the React viewport may be replaced without moving
 * parser state into component instances.
 */
export class IncrementalMarkdownParser {
	#cache: CacheEntry[] = []
	#generation: AbortController | null = null

	public cancel(): void {
		this.#generation?.abort()
	}

	public async parse(
		source: readonly MarkdownSourceBlock[],
		options: {
			readonly signal?: AbortSignal
			readonly yieldAfterUtf16Units?: number
		} = {},
	): Promise<MarkdownParseResult> {
		this.cancel()
		const generation = new AbortController()
		this.#generation = generation
		const abort = (): void => {
			generation.abort()
		}
		if (options.signal?.aborted) abort()
		options.signal?.addEventListener(`abort`, abort, { once: true })
		const started = performance.now()
		const yieldAfter = options.yieldAfterUtf16Units ?? 16_384
		let sinceYield = 0
		let scannedUtf16Units = 0
		let parsedBlocks = 0
		let reusedBlocks = 0
		let stableBoundaryIndex: number | null = null
		let propagating = false
		const next: CacheEntry[] = []
		const semantic: MarkdownSemanticBlock[] = []
		let state: ParseState = { fence: null }

		try {
			// Even the first bounded slice begins outside the browser input turn.
			await turn()
			for (let index = 0; index < source.length; index++) {
				if (generation.signal.aborted) throw generation.signal.reason
				const item = source[index]
				const cached = this.#cache[index]
				if (
					cached !== undefined &&
					sameSource(cached.source, item) &&
					sameState(cached.input, state)
				) {
					next.push(cached)
					semantic.push(...cached.semantic)
					state = cached.output
					reusedBlocks++
					if (propagating) {
						stableBoundaryIndex = index
						propagating = false
					}
					continue
				}
				propagating = true
				stableBoundaryIndex = null
				const parsed = parseOne(item, state)
				const entry = {
					input: state,
					output: parsed.output,
					semantic: parsed.semantic,
					source: item,
				}
				next.push(entry)
				semantic.push(...parsed.semantic)
				state = parsed.output
				parsedBlocks++
				scannedUtf16Units += item.text.length
				sinceYield += item.text.length
				if (sinceYield >= yieldAfter) {
					sinceYield = 0
					await turn()
				}
			}
			if (state.fence !== null) {
				semantic.push({ ...state.fence, kind: `code` })
			}
			if (!generation.signal.aborted) this.#cache = next
			return {
				blocks: semantic,
				instrumentation: {
					canceled: false,
					elapsedMs: performance.now() - started,
					parsedBlocks,
					reusedBlocks,
					scannedUtf16Units,
					stableBoundaryIndex,
				},
			}
		} catch (error) {
			if (!generation.signal.aborted) throw error
			return {
				blocks: [],
				instrumentation: {
					canceled: true,
					elapsedMs: performance.now() - started,
					parsedBlocks,
					reusedBlocks,
					scannedUtf16Units,
					stableBoundaryIndex,
				},
			}
		} finally {
			options.signal?.removeEventListener(`abort`, abort)
			if (this.#generation === generation) this.#generation = null
		}
	}
}
