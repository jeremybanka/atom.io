import type {
	MosaicTextOperation,
	MosaicTextSelection,
	MosaicTextView,
} from "atom.io/realtime"
import { defineMosaicAtomRegistration } from "atom.io/realtime-server"
import { z } from "zod"

import {
	Markdown,
	markdownAtom,
	type MarkdownPresence,
} from "../src/collaboration/mosaic.ts"

const idSchema = z.string().min(1).max(512)
const nullableIdSchema = idSchema.nullable()

const boundarySchema = z
	.object({
		offset: z.number().int().nonnegative().max(1_000_000),
		runId: idSchema,
	})
	.strict()

const relativePositionSchema = z
	.object({
		affinity: z.enum([`left`, `right`]),
		offset: z.number().int().nonnegative().max(1_000_000),
		runId: nullableIdSchema,
	})
	.strict()

const selectionSchema = z
	.object({
		anchor: relativePositionSchema,
		head: relativePositionSchema,
	})
	.strict()

const operationSchema = z.discriminatedUnion(`type`, [
	z
		.object({
			deleted: z
				.array(
					z
						.object({
							end: z.number().int().positive().max(1_000_000),
							runId: idSchema,
							start: z.number().int().nonnegative().max(1_000_000),
						})
						.strict(),
				)
				.max(16_384),
			inserted: z
				.array(
					z
						.object({
							after: boundarySchema.nullable(),
							before: boundarySchema.nullable(),
							id: idSchema,
							text: z.string().min(1).max(4_000_000),
						})
						.strict(),
				)
				.max(16),
			type: z.literal(`edit`),
		})
		.strict(),
	z
		.object({
			mode: z.enum([`redo`, `undo`]),
			targetOperationIds: z.array(idSchema).min(1).max(10_000),
			type: z.literal(`history`),
		})
		.strict(),
]) satisfies z.ZodType<MosaicTextOperation>

const presenceSchema = z
	.object({
		color: z.string().min(1).max(64),
		lastActiveAt: z.number().finite().nonnegative(),
		name: z.string().min(1).max(128),
		selection: selectionSchema.nullable(),
	})
	.strict() satisfies z.ZodType<MarkdownPresence>

const selectionResolvesWithin = (
	document: MosaicTextView,
	selection: MosaicTextSelection,
): boolean =>
	[selection.anchor, selection.head].every((position) => {
		const offset = document.resolvePosition(position)
		return offset >= 0 && offset <= document.length
	})

export const markdownAtomRegistration = defineMosaicAtomRegistration({
	checkpointEvery: 128,
	class: Markdown,
	operationSchema,
	presenceSchema,
	target: markdownAtom,
	validatePresence: (presence, { view }) =>
		presence.selection === null ||
		selectionResolvesWithin(view, presence.selection),
})
