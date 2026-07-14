import { scopeFamily, Silo } from "atom.io"

export const documentSilo = new Silo({
	name: `document`,
	lifespan: `ephemeral`,
	isProduction: false,
})

export const glyphNameAtoms = documentSilo.atomFamily<string, string>({
	key: `glyphName`,
	default: `Untitled glyph`,
})

export const glyphTimelines = documentSilo.timelineFamily<string>({
	key: `glyph`,
	scope: [
		scopeFamily(glyphNameAtoms, {
			timelineKey: (glyphId) => glyphId,
		}),
	],
})

export function undoGlyph(glyphId: string): void {
	documentSilo.undo(glyphTimelines, glyphId)
}

export function closeGlyph(glyphId: string): void {
	documentSilo.disposeTimeline(glyphTimelines, glyphId)
}
