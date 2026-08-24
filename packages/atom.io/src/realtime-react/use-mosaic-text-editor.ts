import type {
	MosaicTextRelativePosition,
	MosaicTextSelection,
} from "atom.io/realtime"
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
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

export type MosaicTextEditorPeer<Value> = {
	readonly id: string
	readonly selection: MosaicTextSelection | null
	readonly value: Value
}

export type MosaicTextEditorRemoteSelection<Value> = {
	readonly end: number
	readonly id: string
	readonly start: number
	readonly value: Value
}

export type MosaicTextEditorView<Value> = {
	readonly hasLocalDraft: boolean
	readonly hasLocalSelection: boolean
	onDirty(): void
	onSelectionChange(anchor: number, head: number): void
	onValueChange(value: string, composing: boolean): void
	readonly projection: MosaicTextRangeProjection | null
	readonly remoteSelections: readonly MosaicTextEditorRemoteSelection<Value>[]
	readonly selection: readonly [number, number] | null
	readonly text: string
}

export type UseMosaicTextEditorOptions<Value> = {
	readonly client: Pick<
		MosaicTextProjectionClient,
		`positionAtOffset` | `readLength` | `resolvePosition`
	>
	readonly commitDelayMs?: number
	readonly connected: boolean
	readonly documentLength: number
	readonly onDocumentLength?: (length: number) => void
	readonly onError?: (error: unknown) => void
	readonly peers: readonly MosaicTextEditorPeer<Value>[]
	readonly projection: MosaicTextRangeProjection | null
	readonly publishSelection: (
		selection: MosaicTextSelection,
	) => Promise<void> | void
	readonly replace: (input: {
		readonly selection: MosaicTextSelection
		readonly text: string
	}) => Promise<void>
}

type PendingSelection = {
	readonly anchorOffset: number
	readonly headOffset: number
}

type RenderedProjection = {
	readonly projection: MosaicTextRangeProjection
	readonly selection: readonly [number, number] | null
}

type SettledDraft = {
	readonly baseProjection: MosaicTextRangeProjection
	readonly baseRevision: number
	readonly requiredEnd: number
}

type ResolvedRemote<Value> = MosaicTextEditorRemoteSelection<Value>

type ResolvedRemoteState<Value> = {
	readonly projection: MosaicTextRangeProjection
	readonly selections: readonly ResolvedRemote<Value>[]
}

type DisplayedRemoteState<Value> = {
	readonly projection: MosaicTextRangeProjection
	readonly rangeStart: number
	readonly selections: readonly ResolvedRemote<Value>[]
	readonly text: string
}

const WAITING_FOR_RESIDENT_SELECTION = Symbol(`waiting-for-resident-selection`)

function isSameProjectionCut(
	left: MosaicTextRangeProjection,
	right: MosaicTextRangeProjection,
): boolean {
	return (
		left === right ||
		(left.revision === right.revision &&
			left.range.start === right.range.start &&
			left.range.end === right.range.end &&
			left.text === right.text)
	)
}

function resolveResidentRemoteSelection<Value>(
	projection: MosaicTextRangeProjection,
	peer: MosaicTextEditorPeer<Value>,
): ResolvedRemote<Value> | null {
	if (peer.selection === null) return null
	const anchor = resolveMosaicTextProjectionPosition(
		projection,
		peer.selection.anchor,
	)
	const head = resolveMosaicTextProjectionPosition(
		projection,
		peer.selection.head,
	)
	if (anchor === null || head === null) return null
	const absoluteStart = Math.min(anchor, head)
	const absoluteEnd = Math.max(anchor, head)
	const viewStart = projection.range.start
	const viewEnd = projection.range.end
	const residentEnd = viewStart + projection.text.length
	if (
		absoluteStart === absoluteEnd
			? absoluteStart < viewStart || absoluteStart > viewEnd
			: absoluteEnd <= viewStart || absoluteStart >= viewEnd
	) {
		return null
	}
	if (absoluteEnd > residentEnd) return null
	return {
		end: Math.max(0, Math.min(projection.text.length, head - viewStart)),
		id: peer.id,
		start: Math.max(0, Math.min(projection.text.length, anchor - viewStart)),
		value: peer.value,
	}
}

function reprojectRetainedRemoteSelection<Value>(
	previous: DisplayedRemoteState<Value>,
	projection: MosaicTextRangeProjection,
	selection: ResolvedRemote<Value>,
): ResolvedRemote<Value> | null {
	if (previous.text !== previous.projection.text) return null
	const anchor = positionAtMosaicTextProjectionOffset(
		previous.projection,
		previous.rangeStart + selection.start,
		`right`,
	)
	const head = positionAtMosaicTextProjectionOffset(
		previous.projection,
		previous.rangeStart + selection.end,
		`right`,
	)
	if (anchor === null || head === null) return null
	return resolveResidentRemoteSelection(projection, {
		id: selection.id,
		selection: { anchor, head },
		value: selection.value,
	})
}

/**
 * Renderer-neutral editing lifecycle for one bounded Mosaic text projection.
 *
 * The hook keeps logical selections paired with the projection cut that resolved
 * them, retains optimistic drafts until a complete newer cut settles, and maps
 * collaborator selections through the same visible text deltas.
 */
export function useMosaicTextEditor<Value>(
	options: UseMosaicTextEditorOptions<Value>,
): MosaicTextEditorView<Value> {
	const commitDelayMs = options.commitDelayMs ?? 120
	const connectedRef = useRef(options.connected)
	connectedRef.current = options.connected
	const documentLengthRef = useRef(options.documentLength)
	documentLengthRef.current = options.documentLength
	const onDocumentLengthRef = useRef(options.onDocumentLength)
	onDocumentLengthRef.current = options.onDocumentLength
	const onErrorRef = useRef(options.onError)
	onErrorRef.current = options.onError
	const publishSelectionRef = useRef(options.publishSelection)
	publishSelectionRef.current = options.publishSelection
	const replaceRef = useRef(options.replace)
	replaceRef.current = options.replace
	const [draft, setDraft] = useState<string | null>(null)
	const [localDirty, setLocalDirty] = useState(false)
	const [hasLocalSelection, setHasLocalSelection] = useState(false)
	const pendingDraft = useRef<{ readonly value: string } | null>(null)
	const pendingSelection = useRef<PendingSelection | null>(null)
	const resolvedPendingSelection = useRef<PendingSelection | null>(null)
	const localSelectionPending = useRef(false)
	const logicalSelection = useRef<MosaicTextSelection | null>(null)
	const [renderedProjection, setRenderedProjection] =
		useState<RenderedProjection | null>(null)
	const projection = renderedProjection?.projection ?? null
	const projectionRef = useRef(projection)
	projectionRef.current = projection
	const [settledDraft, setSettledDraft] = useState<SettledDraft | null>(null)
	const settledDraftRef = useRef(settledDraft)
	settledDraftRef.current = settledDraft
	const committing = useRef(false)
	const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
	const [resolvedRemoteSelections, setResolvedRemoteSelections] =
		useState<ResolvedRemoteState<Value> | null>(null)
	const resolvedRemoteSelectionsRef = useRef(resolvedRemoteSelections)
	useLayoutEffect(() => {
		resolvedRemoteSelectionsRef.current = resolvedRemoteSelections
	}, [resolvedRemoteSelections])
	const displayedRemoteSelectionsRef =
		useRef<DisplayedRemoteState<Value> | null>(null)
	const displayed = draft ?? projection?.text ?? ``
	const reportError = useCallback(
		(error: unknown): void => onErrorRef.current?.(error),
		[],
	)

	// Prefer logical positions resident in this cut. When presence arrives ahead
	// of its text run, reproject the last cursor through shared run identities;
	// never reinterpret an old numeric offset against unrelated bounded cuts.
	const nextDisplayedRemoteSelections = (() => {
		if (projection === null) return null
		const previous = displayedRemoteSelectionsRef.current
		const resolvedProjection = resolvedRemoteSelections?.projection
		const resolvedCutIsCurrent =
			resolvedProjection !== undefined &&
			isSameProjectionCut(resolvedProjection, projection)
		const candidates = options.peers.flatMap((peer) => {
			if (peer.selection === null) return []
			const resident = resolveResidentRemoteSelection(projection, peer)
			if (resident !== null) {
				return [{ selection: resident, sourceText: projection.text }]
			}
			const retainedState =
				previous?.rangeStart === projection.range.start ? previous : null
			const retained = retainedState?.selections.find(
				(selection) => selection.id === peer.id,
			)
			const reprojected =
				retainedState === null || retained === undefined
					? null
					: reprojectRetainedRemoteSelection(retainedState, projection, retained)
			if (resolvedCutIsCurrent) {
				const resolved = resolvedRemoteSelections?.selections.find(
					(selection) => selection.id === peer.id,
				)
				const resolvedAtBoundary =
					resolved !== undefined &&
					[resolved.start, resolved.end].some(
						(offset) => offset === 0 || offset === projection.text.length,
					)
				if (
					resolvedAtBoundary &&
					retainedState !== null &&
					retained !== undefined &&
					[retained.start, retained.end].every(
						(offset) => offset !== 0 && offset !== retainedState.text.length,
					)
				) {
					if (reprojected !== null) {
						return [{ selection: reprojected, sourceText: projection.text }]
					}
					return [{ selection: retained, sourceText: retainedState.text }]
				}
				return resolved === undefined
					? []
					: [{ selection: resolved, sourceText: projection.text }]
			}
			if (reprojected !== null) {
				return [{ selection: reprojected, sourceText: projection.text }]
			}
			return retained === undefined || retainedState === null
				? []
				: [{ selection: retained, sourceText: retainedState.text }]
		})
		const selections = candidates.map(({ selection, sourceText }) => {
			if (sourceText === displayed) return selection
			const [start, end] = transformMosaicTextSelection(sourceText, displayed, [
				selection.start,
				selection.end,
			])
			return { ...selection, end, start }
		})
		return {
			projection,
			rangeStart: projection.range.start,
			selections,
			text: displayed,
		} satisfies DisplayedRemoteState<Value>
	})()
	useLayoutEffect(() => {
		displayedRemoteSelectionsRef.current = nextDisplayedRemoteSelections
	}, [nextDisplayedRemoteSelections])
	const displayedRemoteSelections =
		nextDisplayedRemoteSelections?.selections ?? []

	const publishPendingSelection = useCallback((): void => {
		const selection = pendingSelection.current
		const currentProjection = projectionRef.current
		if (
			selection === null ||
			currentProjection === null ||
			pendingDraft.current !== null ||
			settledDraftRef.current !== null
		) {
			return
		}
		if (
			!localSelectionPending.current &&
			resolvedPendingSelection.current === selection
		) {
			return
		}
		const anchorIndex = currentProjection.range.start + selection.anchorOffset
		const headIndex = currentProjection.range.start + selection.headOffset
		const residentAnchor = positionAtMosaicTextProjectionOffset(
			currentProjection,
			anchorIndex,
		)
		const residentHead = positionAtMosaicTextProjectionOffset(
			currentProjection,
			headIndex,
		)
		void Promise.all([
			residentAnchor ?? options.client.positionAtOffset(anchorIndex),
			residentHead ?? options.client.positionAtOffset(headIndex),
		])
			.then(([anchor, head]) => {
				if (
					pendingSelection.current !== selection ||
					pendingDraft.current !== null ||
					settledDraftRef.current !== null
				) {
					return
				}
				const resolvedSelection = { anchor, head }
				resolvedPendingSelection.current = selection
				logicalSelection.current = resolvedSelection
				localSelectionPending.current = false
				return publishSelectionRef.current(resolvedSelection)
			})
			.catch(reportError)
	}, [options.client, reportError])

	useEffect(() => {
		const incoming = options.projection
		if (incoming === null || incoming.complete === false) return
		if (
			pendingDraft.current !== null ||
			settledDraftRef.current !== null ||
			localSelectionPending.current
		) {
			const localSelection = pendingSelection.current
			setRenderedProjection({
				projection: incoming,
				selection:
					localSelection === null
						? null
						: [localSelection.anchorOffset, localSelection.headOffset],
			})
			return
		}
		const selection = logicalSelection.current
		if (selection === null) {
			setRenderedProjection({ projection: incoming, selection: null })
			return
		}
		let active = true
		const residentAnchor = resolveMosaicTextProjectionPosition(
			incoming,
			selection.anchor,
		)
		const residentHead = resolveMosaicTextProjectionPosition(
			incoming,
			selection.head,
		)
		const resolved =
			residentAnchor === null || residentHead === null
				? Promise.all([
						options.client.resolvePosition(selection.anchor),
						options.client.resolvePosition(selection.head),
					])
				: Promise.resolve([residentAnchor, residentHead] as const)
		void resolved
			.then(([anchor, head]) => {
				if (!active || logicalSelection.current !== selection) return
				const start = incoming.range.start
				const residentEnd = start + incoming.text.length
				const previous = pendingSelection.current
				if (
					(residentAnchor === null || residentHead === null) &&
					previous !== null &&
					[anchor, head].some(
						(offset) => offset === start || offset === residentEnd,
					) &&
					[previous.anchorOffset, previous.headOffset].every(
						(offset) => offset !== 0 && offset !== incoming.text.length,
					)
				) {
					return
				}
				if (
					[anchor, head].some(
						(offset) => offset > residentEnd && offset <= incoming.range.end,
					)
				) {
					return
				}
				const projectedSelection = {
					anchorOffset: Math.max(
						0,
						Math.min(incoming.text.length, anchor - start),
					),
					headOffset: Math.max(0, Math.min(incoming.text.length, head - start)),
				}
				pendingSelection.current = projectedSelection
				resolvedPendingSelection.current = projectedSelection
				setRenderedProjection({
					projection: incoming,
					selection: [
						projectedSelection.anchorOffset,
						projectedSelection.headOffset,
					],
				})
			})
			.catch(reportError)
		return () => {
			active = false
		}
	}, [options.client, options.projection, reportError])

	const commitDraft = useCallback(async (): Promise<void> => {
		const pending = pendingDraft.current
		if (
			pending === null ||
			committing.current ||
			settledDraftRef.current !== null ||
			!connectedRef.current ||
			projectionRef.current === null
		) {
			return
		}
		committing.current = true
		if (commitTimer.current !== null) {
			clearTimeout(commitTimer.current)
			commitTimer.current = null
		}
		try {
			const base = projectionRef.current
			if (base === null) return
			const coveredDocumentEnd = base.range.end >= documentLengthRef.current
			if (base.text !== pending.value) {
				const change = mosaicTextContiguousEdit(base.text, pending.value)
				const expectedRangeEnd = Math.max(
					base.range.start,
					base.range.end + pending.value.length - base.text.length,
				)
				const anchorOffset = base.range.start + change.start
				const headOffset = base.range.start + change.end
				const residentAnchor = positionAtMosaicTextProjectionOffset(
					base,
					anchorOffset,
				)
				const residentHead = positionAtMosaicTextProjectionOffset(
					base,
					headOffset,
				)
				const insertionPosition =
					anchorOffset === headOffset
						? positionAtMosaicTextProjectionOffset(base, anchorOffset, `right`)
						: null
				const [anchor, head] =
					insertionPosition === null
						? await Promise.all([
								residentAnchor ?? options.client.positionAtOffset(anchorOffset),
								residentHead ?? options.client.positionAtOffset(headOffset),
							])
						: ([insertionPosition, insertionPosition] as const)
				if (pendingDraft.current !== pending) return
				await replaceRef.current({
					selection: { anchor, head },
					text: change.text,
				})
				const authoritativeLength = await options.client
					.readLength()
					.catch((error) => {
						reportError(error)
						return null
					})
				if (authoritativeLength !== null) {
					onDocumentLengthRef.current?.(authoritativeLength)
				}
				const settlement = {
					baseProjection: base,
					baseRevision: base.revision ?? -1,
					requiredEnd: coveredDocumentEnd
						? (authoritativeLength ?? expectedRangeEnd)
						: base.range.end,
				}
				settledDraftRef.current = settlement
				setSettledDraft(settlement)
				if (pendingDraft.current === pending) pendingDraft.current = null
				return
			}
			if (pendingDraft.current === pending) {
				pendingDraft.current = null
				setDraft(null)
				setLocalDirty(false)
				settledDraftRef.current = null
				setSettledDraft(null)
			}
		} catch (error) {
			reportError(error)
		} finally {
			committing.current = false
			if (pendingDraft.current !== null && pendingDraft.current !== pending) {
				commitTimer.current = setTimeout(() => void commitDraft(), commitDelayMs)
			}
		}
	}, [commitDelayMs, options.client, reportError])

	const scheduleCommit = useCallback((): void => {
		if (commitTimer.current !== null) clearTimeout(commitTimer.current)
		commitTimer.current = setTimeout(() => {
			commitTimer.current = null
			void commitDraft()
		}, commitDelayMs)
	}, [commitDelayMs, commitDraft])

	useEffect(() => {
		if (options.connected) scheduleCommit()
	}, [options.connected, scheduleCommit])

	useEffect(() => {
		if (
			settledDraft === null ||
			draft === null ||
			projection === null ||
			(projection.revision === undefined
				? projection === settledDraft.baseProjection
				: projection.revision <= settledDraft.baseRevision) ||
			projection.range.end < settledDraft.requiredEnd ||
			projection.range.start + projection.text.length < settledDraft.requiredEnd
		) {
			return
		}
		settledDraftRef.current = null
		setSettledDraft(null)
		if (pendingDraft.current === null) {
			setDraft(null)
			setLocalDirty(false)
		} else {
			scheduleCommit()
		}
	}, [draft, projection, scheduleCommit, settledDraft])

	useEffect(() => {
		if (projection === null || draft !== null) return
		if (pendingSelection.current !== null) publishPendingSelection()
	}, [draft, projection, publishPendingSelection])

	useEffect(() => {
		if (projection === null) {
			setResolvedRemoteSelections(null)
			return
		}
		let active = true
		void Promise.all(
			options.peers.flatMap((peer) => {
				if (peer.selection === null) return []
				return [
					(async () => {
						const residentAnchor = resolveMosaicTextProjectionPosition(
							projection,
							peer.selection!.anchor,
						)
						const residentHead = resolveMosaicTextProjectionPosition(
							projection,
							peer.selection!.head,
						)
						const [anchor, head] =
							residentAnchor === null || residentHead === null
								? await Promise.all([
										options.client.resolvePosition(peer.selection!.anchor),
										options.client.resolvePosition(peer.selection!.head),
									])
								: [residentAnchor, residentHead]
						const absoluteStart = Math.min(anchor, head)
						const absoluteEnd = Math.max(anchor, head)
						const viewStart = projection.range.start
						const viewEnd = projection.range.end
						const residentEnd = viewStart + projection.text.length
						const previousState = resolvedRemoteSelectionsRef.current
						const previous = previousState?.selections.find(
							(selection) => selection.id === peer.id,
						)
						if (
							(residentAnchor === null || residentHead === null) &&
							previous !== undefined
						) {
							const previousStart =
								previousState!.projection.range.start + previous.start
							const previousEnd =
								previousState!.projection.range.start + previous.end
							if (
								[anchor, head].some(
									(offset) => offset === viewStart || offset === residentEnd,
								) &&
								[previousStart, previousEnd].every(
									(offset) => offset !== viewStart && offset !== residentEnd,
								)
							) {
								return WAITING_FOR_RESIDENT_SELECTION
							}
						}
						if (
							absoluteStart === absoluteEnd
								? absoluteStart < viewStart || absoluteStart > viewEnd
								: absoluteEnd <= viewStart || absoluteStart >= viewEnd
						) {
							return null
						}
						if (absoluteEnd > residentEnd) return WAITING_FOR_RESIDENT_SELECTION
						return {
							end: Math.max(
								0,
								Math.min(projection.text.length, head - viewStart),
							),
							id: peer.id,
							start: Math.max(
								0,
								Math.min(projection.text.length, anchor - viewStart),
							),
							value: peer.value,
						} satisfies ResolvedRemote<Value>
					})(),
				]
			}),
		)
			.then((resolved) => {
				if (active && !resolved.includes(WAITING_FOR_RESIDENT_SELECTION)) {
					setResolvedRemoteSelections({
						projection,
						selections: resolved.filter(
							(item): item is ResolvedRemote<Value> =>
								item !== null && item !== WAITING_FOR_RESIDENT_SELECTION,
						),
					})
				}
			})
			.catch(reportError)
		return () => {
			active = false
		}
	}, [options.client, options.peers, projection, reportError])

	useEffect(
		() => () => {
			if (commitTimer.current !== null) clearTimeout(commitTimer.current)
		},
		[],
	)

	const onSelectionChange = useCallback(
		(anchorOffset: number, headOffset: number): void => {
			const current = pendingSelection.current
			if (
				current?.anchorOffset === anchorOffset &&
				current.headOffset === headOffset
			) {
				return
			}
			pendingSelection.current = { anchorOffset, headOffset }
			setHasLocalSelection(true)
			publishPendingSelection()
		},
		[publishPendingSelection],
	)

	const onValueChange = useCallback(
		(value: string, composing: boolean): void => {
			if (value === displayed) {
				if (pendingDraft.current === null) {
					localSelectionPending.current = false
					setLocalDirty(false)
				}
				if (!composing && pendingDraft.current !== null) scheduleCommit()
				return
			}
			localSelectionPending.current = true
			setDraft(value)
			pendingDraft.current = { value }
			if (!composing) scheduleCommit()
		},
		[displayed, scheduleCommit],
	)

	return {
		hasLocalDraft: localDirty || draft !== null,
		hasLocalSelection,
		onDirty() {
			localSelectionPending.current = true
			setLocalDirty(true)
		},
		onSelectionChange,
		onValueChange,
		projection,
		remoteSelections: displayedRemoteSelections,
		selection: draft === null ? (renderedProjection?.selection ?? null) : null,
		text: displayed,
	}
}
