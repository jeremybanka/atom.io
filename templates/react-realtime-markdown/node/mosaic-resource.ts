import type {
	MosaicTextOperation,
	MosaicTextSelection,
	MosaicTextState,
	StandardSchemaV1,
} from "atom.io/realtime"
import {
	defineMosaicServerResource,
	type MosaicHistoryPolicy,
} from "atom.io/realtime-server"

import {
	markdownModel,
	markdownResource,
	type MarkdownPresence,
} from "../src/collaboration/mosaic.ts"

const operationSchema: StandardSchemaV1<unknown, MosaicTextOperation> = {
	"~standard": {
		validate: (value): StandardSchemaV1.Result<MosaicTextOperation> => {
			if (
				typeof value === `object` &&
				value !== null &&
				(Reflect.get(value, `type`) === `edit` ||
					Reflect.get(value, `type`) === `history`)
			) {
				return { value: value as MosaicTextOperation }
			}
			return { issues: [{ message: `Expected a Mosaic text operation.` }] }
		},
		vendor: `atom.io/mosaic-text`,
		version: 1,
	},
}

const isRelativePosition = (value: unknown): boolean =>
	typeof value === `object` &&
	value !== null &&
	(Reflect.get(value, `affinity`) === `left` ||
		Reflect.get(value, `affinity`) === `right`) &&
	(Reflect.get(value, `leftId`) === null ||
		typeof Reflect.get(value, `leftId`) === `string`) &&
	(Reflect.get(value, `rightId`) === null ||
		typeof Reflect.get(value, `rightId`) === `string`)

const isSelection = (value: unknown): value is MosaicTextSelection =>
	typeof value === `object` &&
	value !== null &&
	isRelativePosition(Reflect.get(value, `anchor`)) &&
	isRelativePosition(Reflect.get(value, `head`))

const presenceSchema: StandardSchemaV1<unknown, MarkdownPresence> = {
	"~standard": {
		validate: (value): StandardSchemaV1.Result<MarkdownPresence> => {
			if (
				typeof value === `object` &&
				value !== null &&
				typeof Reflect.get(value, `color`) === `string` &&
				typeof Reflect.get(value, `lastActiveAt`) === `number` &&
				typeof Reflect.get(value, `name`) === `string` &&
				(Reflect.get(value, `selection`) === null ||
					isSelection(Reflect.get(value, `selection`)))
			) {
				return { value: value as MarkdownPresence }
			}
			return { issues: [{ message: `Expected Markdown presence.` }] }
		},
		vendor: `atom.io/mosaic-text`,
		version: 1,
	},
}

const markdownTimeline = {
	request: (operation) =>
		operation.type === `history`
			? {
					mode: operation.mode,
					targetOperationIds: operation.targetOperationIds,
				}
			: null,
	timeline: (state, actor) => {
		const actorTimeline = markdownModel.timeline(state, actor)
		return {
			redo: actorTimeline.redo.map(({ group, targetOperationIds }) => ({
				group,
				operationIds: targetOperationIds,
			})),
			undo: actorTimeline.undo.map(({ group, targetOperationIds }) => ({
				group,
				operationIds: targetOperationIds,
			})),
		}
	},
} satisfies MosaicHistoryPolicy<MosaicTextState, MosaicTextOperation>

const referencesKnownNode = (
	state: MosaicTextState,
	selection: MosaicTextSelection,
): boolean =>
	[
		selection.anchor.leftId,
		selection.anchor.rightId,
		selection.head.leftId,
		selection.head.rightId,
	].every((id) => id === null || state.nodes[id] !== undefined)

export const markdownServerResource = defineMosaicServerResource({
	...markdownResource,
	checkpointEvery: 128,
	history: markdownTimeline,
	operationSchema,
	presenceSchema,
	validatePresence: (presence, { state }) =>
		presence.selection === null ||
		referencesKnownNode(state, presence.selection),
})
