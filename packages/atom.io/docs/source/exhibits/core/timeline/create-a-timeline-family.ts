import {
	atomFamily,
	disposeTimeline,
	findTimeline,
	inspectTimeline,
	scopeFamily,
	setState,
	timelineFamily,
} from "atom.io"

type PointKey = readonly [glyphId: string, pointId: string]

export const glyphNameAtoms = atomFamily<string, string>({
	key: `glyphName`,
	default: `Untitled glyph`,
})

export const pointXAtoms = atomFamily<number, PointKey>({
	key: `pointX`,
	default: 0,
})

export const glyphTimelines = timelineFamily<string>({
	key: `glyphTimeline`,
	scope: [
		scopeFamily(glyphNameAtoms, {
			timelineKey: (glyphId) => glyphId,
		}),
		scopeFamily(pointXAtoms, {
			timelineKey: ([glyphId]) => (glyphId === `preview` ? undefined : glyphId),
		}),
	],
})

export function editPoint(glyphId: string, pointId: string, x: number): void {
	const glyphTimeline = findTimeline(glyphTimelines, glyphId)
	setState(pointXAtoms, [glyphId, pointId], x)

	inspectTimeline(glyphTimeline) // -> { at: 1, length: 1 }
}

export function closeGlyph(glyphId: string): void {
	disposeTimeline(glyphTimelines, glyphId)
}
