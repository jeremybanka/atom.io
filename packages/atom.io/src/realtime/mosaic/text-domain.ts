import type { Json } from "atom.io/foundations/json"

import type {
	MosaicDomainTransceiverModel,
	MosaicDomainValueModel,
} from "../mosaic-domain-batch.ts"
import type { StandardSchemaV1 } from "../standard-schema.ts"
import type {
	MosaicTextConstructor,
	MosaicTextOperation,
	MosaicTextSnapshot,
	MosaicTextTransceiver,
} from "./text.ts"
import type {
	MosaicTextIndexMember,
	MosaicTextIndexOptions,
	MosaicTextIndexRoot,
} from "./text-index.ts"

export type MosaicTextIndexSetOperation<Value> = {
	readonly type: `set`
	readonly value: Value
}

type MosaicTextOperationLimits = {
	readonly maximumDeletionIntervalsPerOperation: number
	readonly maximumHistoryTargets: number
	readonly maximumRunUtf16Units: number
	readonly maximumRunsPerOperation: number
}

const standardKey = `~standard` as const

type SynchronousStandardSchema<Value> = StandardSchemaV1<unknown, Value> & {
	readonly [standardKey]: StandardSchemaV1.Props<unknown, Value> & {
		readonly validate: (value: unknown) => StandardSchemaV1.Result<Value>
	}
}

export type MosaicTextDomainModels = {
	readonly emptyIndexRoot: MosaicTextIndexRoot
	readonly indexMemberModel: MosaicDomainValueModel<
		MosaicTextIndexMember,
		MosaicTextIndexSetOperation<MosaicTextIndexMember> & Json.Serializable
	>
	readonly indexMemberSchema: StandardSchemaV1<unknown, MosaicTextIndexMember>
	readonly indexRootModel: MosaicDomainValueModel<
		MosaicTextIndexRoot,
		MosaicTextIndexSetOperation<MosaicTextIndexRoot> & Json.Serializable
	>
	readonly indexRootSchema: StandardSchemaV1<unknown, MosaicTextIndexRoot>
	readonly sourceModel: MosaicDomainTransceiverModel<MosaicTextTransceiver>
	readonly sourceSnapshotSchema: StandardSchemaV1<unknown, MosaicTextSnapshot>
}

const record = (value: unknown): value is Record<string, unknown> =>
	typeof value === `object` && value !== null && !Array.isArray(value)
const id = (value: unknown): value is string =>
	typeof value === `string` && value.length > 0 && value.length <= 512
const natural = (value: unknown): value is number =>
	Number.isSafeInteger(value) && (value as number) >= 0
const keys = (value: Record<string, unknown>, expected: readonly string[]) => {
	const actual = Object.keys(value).sort()
	return (
		actual.length === expected.length &&
		actual.every((key, index) => key === [...expected].sort()[index])
	)
}
const standardSchema = <Value>(
	name: string,
	validate: (value: unknown) => value is Value,
): SynchronousStandardSchema<Value> => ({
	[standardKey]: {
		validate(value) {
			let cloned: unknown
			try {
				cloned = structuredClone(value)
			} catch {
				return { issues: [{ message: `${name} is not cloneable.` }] }
			}
			return validate(cloned)
				? { value: cloned }
				: { issues: [{ message: `${name} is invalid.` }] }
		},
		vendor: `atom.io`,
		version: 1,
	},
})

const boundary = (value: unknown): boolean =>
	record(value) &&
	keys(value, [`offset`, `runId`]) &&
	id(value[`runId`]) &&
	natural(value[`offset`])

const textOperationSchema = (
	limits: MosaicTextOperationLimits,
): StandardSchemaV1<unknown, MosaicTextOperation> =>
	standardSchema(
		`Mosaic text operation`,
		(value): value is MosaicTextOperation => {
			if (!record(value) || typeof value[`type`] !== `string`) return false
			if (value[`type`] === `history`) {
				return (
					keys(value, [`mode`, `targetOperationIds`, `type`]) &&
					(value[`mode`] === `redo` || value[`mode`] === `undo`) &&
					Array.isArray(value[`targetOperationIds`]) &&
					value[`targetOperationIds`].length > 0 &&
					value[`targetOperationIds`].length <= limits.maximumHistoryTargets &&
					value[`targetOperationIds`].every(id)
				)
			}
			if (
				value[`type`] !== `edit` ||
				!keys(value, [`deleted`, `inserted`, `type`])
			) {
				return false
			}
			const deleted = value[`deleted`]
			const inserted = value[`inserted`]
			return (
				Array.isArray(deleted) &&
				deleted.length <= limits.maximumDeletionIntervalsPerOperation &&
				deleted.every(
					(item) =>
						record(item) &&
						keys(item, [`end`, `runId`, `start`]) &&
						id(item[`runId`]) &&
						natural(item[`start`]) &&
						natural(item[`end`]) &&
						item[`end`] > item[`start`],
				) &&
				Array.isArray(inserted) &&
				inserted.length <= limits.maximumRunsPerOperation &&
				inserted.every(
					(item) =>
						record(item) &&
						keys(item, [`after`, `before`, `id`, `text`]) &&
						(item[`after`] === null || boundary(item[`after`])) &&
						(item[`before`] === null || boundary(item[`before`])) &&
						id(item[`id`]) &&
						typeof item[`text`] === `string` &&
						item[`text`].length > 0 &&
						item[`text`].length <= limits.maximumRunUtf16Units,
				)
			)
		},
	)

const summary = (value: unknown): boolean =>
	record(value) &&
	keys(value, [`graphemes`, `leafCount`, `lineBreaks`, `utf16Units`]) &&
	natural(value[`graphemes`]) &&
	natural(value[`leafCount`]) &&
	natural(value[`lineBreaks`]) &&
	natural(value[`utf16Units`])
const reference = (value: unknown): boolean =>
	record(value) &&
	keys(value, [`id`, `kind`, `summary`]) &&
	id(value[`id`]) &&
	(value[`kind`] === `leaf` || value[`kind`] === `node`) &&
	summary(value[`summary`])
const range = (value: unknown): boolean =>
	record(value) &&
	keys(value, [`end`, `kind`, `start`]) &&
	value[`kind`] === `utf16-range` &&
	natural(value[`start`]) &&
	natural(value[`end`]) &&
	value[`end`] >= value[`start`]

const indexMemberSchema = (
	options: MosaicTextIndexOptions,
): SynchronousStandardSchema<MosaicTextIndexMember> => {
	const maximumFragments = options.maximumFragmentsPerLeaf ?? 64
	const maximumChildren = options.maximumChildrenPerNode ?? 32
	const maximumTargets = options.maximumAliasTargets ?? 8
	const maximumLeafUtf16Units = options.maximumLeafUtf16Units ?? 65_536
	return standardSchema(
		`Mosaic text index member`,
		(value): value is MosaicTextIndexMember => {
			if (!record(value) || !id(value[`id`]) || value[`version`] !== 1) {
				return false
			}
			if (value[`kind`] === `leaf`) {
				return (
					keys(value, [`fragments`, `id`, `kind`, `summary`, `version`]) &&
					Array.isArray(value[`fragments`]) &&
					value[`fragments`].length <= maximumFragments &&
					value[`fragments`].every(
						(fragment) =>
							record(fragment) &&
							keys(fragment, [`runId`, `start`, `text`]) &&
							id(fragment[`runId`]) &&
							natural(fragment[`start`]) &&
							typeof fragment[`text`] === `string` &&
							fragment[`text`].length > 0 &&
							fragment[`text`].length <= maximumLeafUtf16Units,
					) &&
					summary(value[`summary`])
				)
			}
			if (value[`kind`] === `node`) {
				return (
					keys(value, [
						`children`,
						`id`,
						`kind`,
						`level`,
						`summary`,
						`version`,
					]) &&
					Array.isArray(value[`children`]) &&
					value[`children`].length <= maximumChildren &&
					value[`children`].every(reference) &&
					Number.isSafeInteger(value[`level`]) &&
					(value[`level`] as number) > 0 &&
					summary(value[`summary`])
				)
			}
			if (value[`kind`] !== `alias`) return false
			const allowed = [`generation`, `id`, `kind`, `source`, `version`]
			if (`recovery` in value) allowed.push(`recovery`)
			if (`targets` in value) allowed.push(`targets`)
			const recovery = value[`recovery`]
			return (
				keys(value, allowed) &&
				natural(value[`generation`]) &&
				id(value[`source`]) &&
				(value[`targets`] === undefined ||
					(Array.isArray(value[`targets`]) &&
						value[`targets`].length <= maximumTargets &&
						value[`targets`].every(id))) &&
				(recovery === undefined ||
					(record(recovery) &&
						keys(recovery, [`code`, `range`, `reason`]) &&
						recovery[`code`] === `range-resnapshot` &&
						range(recovery[`range`]) &&
						[`alias-fanout`, `alias-missing`, `range-member-limit`].includes(
							recovery[`reason`] as string,
						)))
			)
		},
	)
}

const indexRootSchema = standardSchema(
	`Mosaic text index root`,
	(value): value is MosaicTextIndexRoot =>
		record(value) &&
		keys(value, [`generation`, `id`, `kind`, `reference`, `version`]) &&
		natural(value[`generation`]) &&
		value[`id`] === `root` &&
		value[`kind`] === `root` &&
		(value[`reference`] === null || reference(value[`reference`])) &&
		value[`version`] === 1,
)

const historyFreeSetModel = <Value extends Json.Serializable>(
	key: string,
	valueSchema: SynchronousStandardSchema<Value>,
): MosaicDomainValueModel<
	Value,
	MosaicTextIndexSetOperation<Value> & Json.Serializable
> =>
	({
		history: {
			classify: () => ({ kind: `exclude` as const }),
			compensate: (): never => {
				throw new Error(`Text index maintenance never enters actor history.`)
			},
		},
		identity: { key, version: 1 },
		kind: `value`,
		operationSchema: standardSchema(
			`${key} operation`,
			(value): value is MosaicTextIndexSetOperation<Value> =>
				record(value) &&
				keys(value, [`type`, `value`]) &&
				value[`type`] === `set` &&
				!(`issues` in valueSchema[`~standard`].validate(value[`value`])),
		),
		reduce: (_value, operation) => operation.value,
	}) satisfies MosaicDomainValueModel<
		Value,
		MosaicTextIndexSetOperation<Value> & Json.Serializable
	>

/** Core-owned models and schemas for one v2 Mosaic text plus range index. */
export function createMosaicTextDomainModels(options: {
	readonly index?: MosaicTextIndexOptions
	readonly text: MosaicTextConstructor
}): MosaicTextDomainModels {
	const configuration = (
		options.text.mosaic as typeof options.text.mosaic & {
			readonly configuration: MosaicTextOperationLimits
		}
	).configuration
	const memberSchema = indexMemberSchema(options.index ?? {})
	const sourceSnapshotSchema = standardSchema(
		`Mosaic text snapshot`,
		(value): value is MosaicTextSnapshot => {
			try {
				options.text.fromJSON(value as MosaicTextSnapshot)
				return true
			} catch {
				return false
			}
		},
	)
	return {
		emptyIndexRoot: Object.freeze({
			generation: 0,
			id: `root`,
			kind: `root`,
			reference: null,
			version: 1,
		}) satisfies MosaicTextIndexRoot,
		indexMemberModel: historyFreeSetModel(
			`mosaic-text-index-member`,
			memberSchema,
		),
		indexMemberSchema: memberSchema,
		indexRootModel: historyFreeSetModel(
			`mosaic-text-index-root`,
			indexRootSchema,
		),
		indexRootSchema: indexRootSchema,
		sourceModel: {
			class: options.text,
			kind: `transceiver`,
			operationSchema: textOperationSchema(configuration),
		} as const,
		sourceSnapshotSchema,
	}
}
