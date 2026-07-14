import {
	findTimeline,
	redoTransaction,
	runTransaction,
	transaction,
	undo,
	undoTransaction,
} from "atom.io"

import { glyphTimelines, pointXAtoms } from "./create-a-timeline-family.ts"

export const addExtremaTX = transaction<(glyphIds: readonly string[]) => void>({
	key: `addExtrema`,
	do: ({ set }, glyphIds) => {
		for (const glyphId of glyphIds) {
			set(pointXAtoms, [glyphId, `top-extremum`], 100)
		}
	},
})

export function addExtrema(glyphIds: readonly string[]): void {
	for (const glyphId of glyphIds) {
		findTimeline(glyphTimelines, glyphId)
	}
	runTransaction(addExtremaTX)(glyphIds)
}

export function undoOneGlyph(glyphId: string): void {
	undo(glyphTimelines, glyphId)
}

export function undoAddExtrema(): void {
	undoTransaction(addExtremaTX)
}

export function redoAddExtrema(): void {
	redoTransaction(addExtremaTX)
}
