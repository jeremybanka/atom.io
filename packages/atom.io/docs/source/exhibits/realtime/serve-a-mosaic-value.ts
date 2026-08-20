import { mutableAtom } from "atom.io"
import type { MosaicTextOperation } from "atom.io/realtime"
import { mosaicText } from "atom.io/realtime"
import {
	createMosaicServer,
	defineMosaicAtomRegistration,
} from "atom.io/realtime-server"
import { z } from "zod"

const Markdown = mosaicText({ initialText: `# Shared notes\n` })
const markdownAtom = mutableAtom<InstanceType<typeof Markdown>>({
	class: Markdown,
	key: `markdown`,
})

const boundarySchema = z
	.object({
		offset: z.number().int().nonnegative(),
		runId: z.string().min(1),
	})
	.strict()

const operationSchema: z.ZodType<MosaicTextOperation> = z.discriminatedUnion(
	`type`,
	[
		z
			.object({
				deleted: z.array(
					z
						.object({
							end: z.number().int().nonnegative(),
							runId: z.string().min(1),
							start: z.number().int().nonnegative(),
						})
						.strict(),
				),
				inserted: z.array(
					z
						.object({
							after: boundarySchema.nullable(),
							before: boundarySchema.nullable(),
							id: z.string().min(1),
							text: z.string(),
						})
						.strict(),
				),
				type: z.literal(`edit`),
			})
			.strict(),
		z
			.object({
				mode: z.enum([`undo`, `redo`]),
				targetOperationIds: z.array(z.string().min(1)),
				type: z.literal(`history`),
			})
			.strict(),
	],
)

const markdown = defineMosaicAtomRegistration({
	class: Markdown,
	operationSchema,
	target: markdownAtom,
})

export const mosaicServer = createMosaicServer({
	authorize: ({ action, actor }) => action === `read` || actor === `user-42`,
	registrations: [markdown],
})
