import type {
	MosaicTextOperation,
	MosaicTextSelection,
	MosaicTextView,
} from "atom.io/realtime"
import { defineMosaicServerAtom } from "atom.io/realtime-server"
import { z } from "zod"

import {
	Markdown,
	markdownAtom,
	type MarkdownPresence,
} from "../src/collaboration/mosaic.ts"

const idSchema = z.string().min(1).max(512)
const nullableIdSchema = idSchema.nullable()

const relativePositionSchema = z
	.object({
		affinity: z.enum([`left`, `right`]),
		leftId: nullableIdSchema,
		rightId: nullableIdSchema,
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
			deletedIds: z.array(idSchema).max(200_000),
			inserted: z
				.array(
					z
						.object({
							after: nullableIdSchema,
							before: nullableIdSchema,
							id: idSchema,
							value: z.string().max(1_024),
						})
						.strict(),
				)
				.max(200_000),
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

export const markdownServerAtom = defineMosaicServerAtom({
	checkpointEvery: 128,
	class: Markdown,
	operationSchema,
	presenceSchema,
	target: markdownAtom,
	validatePresence: (presence, { view }) =>
		presence.selection === null ||
		selectionResolvesWithin(view, presence.selection),
})
