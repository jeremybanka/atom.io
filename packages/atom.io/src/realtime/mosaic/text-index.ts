import type { MosaicTextRelativePosition, MosaicTextSnapshot } from "./text.ts"
import { splitMosaicText, visibleMosaicTextRuns } from "./text.ts"

const MAXIMUM_BOUND = 1_000_000

export type MosaicTextIndexSummary = {
	readonly graphemes: number
	readonly leafCount: number
	readonly lineBreaks: number
	readonly utf16Units: number
}

export type MosaicTextIndexFragment = {
	readonly runId: string
	readonly start: number
	readonly text: string
}

export type MosaicTextIndexLeaf = {
	readonly fragments: readonly MosaicTextIndexFragment[]
	readonly id: string
	readonly kind: `leaf`
	readonly summary: MosaicTextIndexSummary
	readonly version: 1
}

export type MosaicTextIndexReference = {
	readonly id: string
	readonly kind: `leaf` | `node`
	readonly summary: MosaicTextIndexSummary
}

export type MosaicTextIndexNode = {
	readonly children: readonly MosaicTextIndexReference[]
	readonly id: string
	/** Leaves are level zero; a node's level is one greater than its children. */
	readonly level: number
	readonly kind: `node`
	readonly summary: MosaicTextIndexSummary
	readonly version: 1
}

export type MosaicTextIndexRange = {
	/** Exclusive UTF-16 end. A collapsed range hydrates its containing leaf. */
	readonly end: number
	readonly kind: `utf16-range`
	readonly start: number
}

export type MosaicTextIndexRecovery = {
	readonly code: `range-resnapshot`
	readonly range: MosaicTextIndexRange
	readonly reason: `alias-fanout` | `alias-missing` | `range-member-limit`
}

export type MosaicTextIndexAlias = {
	readonly generation: number
	readonly id: string
	readonly kind: `alias`
	readonly recovery?: MosaicTextIndexRecovery
	readonly source: string
	readonly targets?: readonly string[]
	readonly version: 1
}

export type MosaicTextIndexMember =
	| MosaicTextIndexAlias
	| MosaicTextIndexLeaf
	| MosaicTextIndexNode

export type MosaicTextIndexRoot = {
	readonly generation: number
	readonly id: `root`
	readonly kind: `root`
	readonly reference: MosaicTextIndexReference | null
	readonly version: 1
}

export type MosaicTextIndexBundle = {
	readonly members: readonly MosaicTextIndexMember[]
	readonly root: MosaicTextIndexRoot
}

export type MosaicTextIndexOptions = {
	readonly maximumAliasGenerations?: number
	readonly maximumAliasTargets?: number
	readonly maximumChildrenPerNode?: number
	readonly maximumFragmentsPerLeaf?: number
	readonly maximumLeafGraphemes?: number
	readonly maximumLeafUtf16Units?: number
	readonly minimumChildrenPerNode?: number
	readonly minimumLeafGraphemes?: number
	readonly targetChildrenPerNode?: number
	readonly targetLeafGraphemes?: number
}

type TextIndexLimits = {
	maximumAliasGenerations: number
	maximumAliasTargets: number
	maximumChildrenPerNode: number
	maximumFragmentsPerLeaf: number
	maximumLeafGraphemes: number
	maximumLeafUtf16Units: number
	minimumChildrenPerNode: number
	minimumLeafGraphemes: number
	targetChildrenPerNode: number
	targetLeafGraphemes: number
}

export type MosaicTextIndexMaintenance = {
	/** Maintenance never participates in an actor's selective text history. */
	readonly history: `exclude`
	readonly kind: `maintenance`
	readonly remove: readonly string[]
	readonly root: MosaicTextIndexRoot | null
	readonly upsert: readonly MosaicTextIndexMember[]
}

export type MosaicTextIndexMaintenanceCounters = {
	readonly aliasesWritten: number
	readonly leavesWritten: number
	readonly membersRemoved: number
	readonly nodesWritten: number
	readonly rootWritten: number
}

export type MosaicTextIndexMaintenanceResult = {
	readonly counters: MosaicTextIndexMaintenanceCounters
	readonly index: MosaicTextIndexBundle
	readonly maintenance: MosaicTextIndexMaintenance
}

type Unit = {
	readonly owner?: string | undefined
	readonly runId: string
	readonly start: number
	readonly text: string
}

type LeafGroup = {
	id: string
	units: Unit[]
}

type ReferenceGroup = {
	id: string
	references: MosaicTextIndexReference[]
}

function boundedInteger(value: unknown, name: string): number {
	if (
		!Number.isSafeInteger(value) ||
		(value as number) < 1 ||
		(value as number) > MAXIMUM_BOUND
	) {
		throw new RangeError(`${name} must be a positive bounded safe integer`)
	}
	return value as number
}

function textIndexLimits(options: MosaicTextIndexOptions = {}): TextIndexLimits {
	const limits: TextIndexLimits = {
		maximumAliasGenerations: boundedInteger(
			options.maximumAliasGenerations ?? 4,
			`maximumAliasGenerations`,
		),
		maximumAliasTargets: boundedInteger(
			options.maximumAliasTargets ?? 8,
			`maximumAliasTargets`,
		),
		maximumChildrenPerNode: boundedInteger(
			options.maximumChildrenPerNode ?? 32,
			`maximumChildrenPerNode`,
		),
		maximumFragmentsPerLeaf: boundedInteger(
			options.maximumFragmentsPerLeaf ?? 256,
			`maximumFragmentsPerLeaf`,
		),
		maximumLeafGraphemes: boundedInteger(
			options.maximumLeafGraphemes ?? 4_096,
			`maximumLeafGraphemes`,
		),
		maximumLeafUtf16Units: boundedInteger(
			options.maximumLeafUtf16Units ?? 65_536,
			`maximumLeafUtf16Units`,
		),
		minimumChildrenPerNode: boundedInteger(
			options.minimumChildrenPerNode ?? 8,
			`minimumChildrenPerNode`,
		),
		minimumLeafGraphemes: boundedInteger(
			options.minimumLeafGraphemes ?? 1_024,
			`minimumLeafGraphemes`,
		),
		targetChildrenPerNode: boundedInteger(
			options.targetChildrenPerNode ?? 16,
			`targetChildrenPerNode`,
		),
		targetLeafGraphemes: boundedInteger(
			options.targetLeafGraphemes ?? 2_048,
			`targetLeafGraphemes`,
		),
	}
	if (
		limits.minimumLeafGraphemes > limits.targetLeafGraphemes ||
		limits.targetLeafGraphemes > limits.maximumLeafGraphemes
	) {
		throw new RangeError(
			`Leaf sizes must satisfy minimumLeafGraphemes <= targetLeafGraphemes <= maximumLeafGraphemes`,
		)
	}
	if (
		limits.minimumChildrenPerNode > limits.targetChildrenPerNode ||
		limits.targetChildrenPerNode > limits.maximumChildrenPerNode
	) {
		throw new RangeError(
			`Node sizes must satisfy minimumChildrenPerNode <= targetChildrenPerNode <= maximumChildrenPerNode`,
		)
	}
	return limits
}

function emptySummary(): MosaicTextIndexSummary {
	return { graphemes: 0, leafCount: 0, lineBreaks: 0, utf16Units: 0 }
}

function addSummary(
	left: MosaicTextIndexSummary,
	right: MosaicTextIndexSummary,
): MosaicTextIndexSummary {
	return {
		graphemes: left.graphemes + right.graphemes,
		leafCount: left.leafCount + right.leafCount,
		lineBreaks: left.lineBreaks + right.lineBreaks,
		utf16Units: left.utf16Units + right.utf16Units,
	}
}

function summaryForUnits(units: readonly Unit[]): MosaicTextIndexSummary {
	let lineBreaks = 0
	let utf16Units = 0
	for (const unit of units) {
		utf16Units += unit.text.length
		for (const character of unit.text) if (character === `\n`) lineBreaks++
	}
	return { graphemes: units.length, leafCount: 1, lineBreaks, utf16Units }
}

function summaryForReferences(
	references: readonly MosaicTextIndexReference[],
): MosaicTextIndexSummary {
	return references.reduce(
		(summary, reference) => addSummary(summary, reference.summary),
		emptySummary(),
	)
}

function hashId(value: string): string {
	let hash = 2_166_136_261
	for (let index = 0; index < value.length; index++) {
		hash ^= value.charCodeAt(index)
		hash = Math.imul(hash, 16_777_619)
	}
	return (hash >>> 0).toString(36)
}

function unitKey(unit: Pick<Unit, `runId` | `start`>): string {
	return JSON.stringify([unit.runId, unit.start])
}

function freshId(
	prefix: `leaf` | `node`,
	seed: string,
	used: Set<string>,
): string {
	const base = `${prefix}:${hashId(seed)}`
	let id = base
	let collision = 1
	while (used.has(id)) id = `${base}:${collision++}`
	used.add(id)
	return id
}

function unitsFromFragments(
	fragments: readonly MosaicTextIndexFragment[],
): Unit[] {
	const units: Unit[] = []
	const seen = new Set<string>()
	for (const fragment of fragments) {
		if (
			typeof fragment.runId !== `string` ||
			fragment.runId.length === 0 ||
			!Number.isSafeInteger(fragment.start) ||
			fragment.start < 0 ||
			typeof fragment.text !== `string` ||
			fragment.text.length === 0
		) {
			throw new Error(`Invalid Mosaic text index fragment`)
		}
		for (const [offset, text] of splitMosaicText(fragment.text).entries()) {
			const unit = {
				runId: fragment.runId,
				start: fragment.start + offset,
				text,
			}
			const key = unitKey(unit)
			if (seen.has(key)) {
				throw new Error(`Duplicate logical Mosaic text index position`)
			}
			seen.add(key)
			units.push(unit)
		}
	}
	return units
}

function fragmentsFromUnits(units: readonly Unit[]): MosaicTextIndexFragment[] {
	const fragments: MosaicTextIndexFragment[] = []
	for (const unit of units) {
		const previous = fragments.at(-1)
		if (
			previous?.runId === unit.runId &&
			previous.start + splitMosaicText(previous.text).length === unit.start
		) {
			fragments[fragments.length - 1] = {
				...previous,
				text: previous.text + unit.text,
			}
		} else {
			fragments.push({ runId: unit.runId, start: unit.start, text: unit.text })
		}
	}
	return fragments
}

function leafFits(units: readonly Unit[], limits: TextIndexLimits): boolean {
	const summary = summaryForUnits(units)
	return (
		summary.graphemes <= limits.maximumLeafGraphemes &&
		summary.utf16Units <= limits.maximumLeafUtf16Units &&
		fragmentsFromUnits(units).length <= limits.maximumFragmentsPerLeaf
	)
}

function leafIsSmall(units: readonly Unit[], limits: TextIndexLimits): boolean {
	return units.length < limits.minimumLeafGraphemes
}

function splitLeafGroup(
	group: LeafGroup,
	keepWithinHysteresis: boolean,
	limits: TextIndexLimits,
	used: Set<string>,
): LeafGroup[] {
	if (keepWithinHysteresis && leafFits(group.units, limits)) return [group]
	const chunks: LeafGroup[] = []
	let units: Unit[] = []
	const flush = (): void => {
		if (units.length === 0) return
		const seed = `${unitKey(units[0])}:${unitKey(units.at(-1)!)}:${units
			.map(({ text }) => text)
			.join(``)}`
		chunks.push({
			id: chunks.length === 0 ? group.id : freshId(`leaf`, seed, used),
			units,
		})
		units = []
	}
	for (const unit of group.units) {
		if (unit.text.length > limits.maximumLeafUtf16Units) {
			throw new RangeError(`A Unicode grapheme exceeds maximumLeafUtf16Units`)
		}
		const candidate = [...units, unit]
		if (
			units.length > 0 &&
			(!leafFits(candidate, limits) ||
				units.length >= limits.targetLeafGraphemes)
		) {
			flush()
		}
		units.push(unit)
	}
	flush()
	return chunks
}

function mergeSmallLeaves(
	groups: LeafGroup[],
	limits: TextIndexLimits,
): LeafGroup[] {
	for (let index = 0; index < groups.length && groups.length > 1; index++) {
		const group = groups[index]
		if (!leafIsSmall(group.units, limits)) continue
		const next = groups[index + 1]
		const previous = groups[index - 1]
		if (
			next !== undefined &&
			leafFits([...group.units, ...next.units], limits)
		) {
			groups.splice(index, 2, {
				id: group.id,
				units: [...group.units, ...next.units],
			})
			index--
		} else if (
			previous !== undefined &&
			leafFits([...previous.units, ...group.units], limits)
		) {
			groups.splice(index - 1, 2, {
				id: previous.id,
				units: [...previous.units, ...group.units],
			})
			index -= 2
		}
	}
	return groups
}

function priorLeaves(
	bundle: MosaicTextIndexBundle | undefined,
): MosaicTextIndexLeaf[] {
	return (
		bundle?.members.filter(
			(member): member is MosaicTextIndexLeaf => member.kind === `leaf`,
		) ?? []
	)
}

function partitionLeaves(
	fragments: readonly MosaicTextIndexFragment[],
	previous: MosaicTextIndexBundle | undefined,
	limits: TextIndexLimits,
): MosaicTextIndexLeaf[] {
	const oldLeaves = priorLeaves(previous)
	const ownerByUnit = new Map<string, string>()
	for (const leaf of oldLeaves) {
		for (const unit of unitsFromFragments(leaf.fragments)) {
			ownerByUnit.set(unitKey(unit), leaf.id)
		}
	}
	const sourceUnits = unitsFromFragments(fragments).map((unit) => ({
		...unit,
		owner: ownerByUnit.get(unitKey(unit)),
	}))
	if (sourceUnits.length === 0) return []
	const nextOwner: (string | undefined)[] = new Array(sourceUnits.length)
	let following: string | undefined
	for (let index = sourceUnits.length - 1; index >= 0; index--) {
		following = sourceUnits[index].owner ?? following
		nextOwner[index] = following
	}
	const used = new Set(oldLeaves.map(({ id }) => id))
	const groups: LeafGroup[] = []
	let currentOwner: string | undefined
	const initialId = (): string =>
		freshId(
			`leaf`,
			`${unitKey(sourceUnits[0])}:${unitKey(sourceUnits.at(-1)!)}`,
			used,
		)
	for (const [index, unit] of sourceUnits.entries()) {
		const owner = unit.owner ?? currentOwner ?? nextOwner[index] ?? initialId()
		const group = groups.at(-1)
		if (group?.id === owner) group.units.push(unit)
		else groups.push({ id: owner, units: [unit] })
		currentOwner = owner
	}
	const oldIds = new Set(oldLeaves.map(({ id }) => id))
	const split = groups.flatMap((group) =>
		splitLeafGroup(group, oldIds.has(group.id), limits, used),
	)
	const balanced = mergeSmallLeaves(split, limits)
	return balanced.map(({ id, units }) => ({
		fragments: fragmentsFromUnits(units),
		id,
		kind: `leaf`,
		summary: summaryForUnits(units),
		version: 1,
	}))
}

function referenceFor(
	member: MosaicTextIndexLeaf | MosaicTextIndexNode,
): MosaicTextIndexReference {
	return { id: member.id, kind: member.kind, summary: member.summary }
}

function packReferenceGroups(
	references: readonly MosaicTextIndexReference[],
	level: number,
	previous: MosaicTextIndexBundle | undefined,
	limits: TextIndexLimits,
	used: Set<string>,
): ReferenceGroup[] {
	const oldNodes =
		previous?.members.filter(
			(member): member is MosaicTextIndexNode =>
				member.kind === `node` && member.level === level,
		) ?? []
	const parentByChild = new Map<string, string>()
	for (const node of oldNodes) {
		for (const child of node.children) parentByChild.set(child.id, node.id)
	}
	const nextParent: (string | undefined)[] = new Array(references.length)
	let following: string | undefined
	for (let index = references.length - 1; index >= 0; index--) {
		following = parentByChild.get(references[index].id) ?? following
		nextParent[index] = following
	}
	let currentParent: string | undefined
	const groups: ReferenceGroup[] = []
	for (const [index, reference] of references.entries()) {
		const existing = parentByChild.get(reference.id)
		const parent =
			existing ??
			currentParent ??
			nextParent[index] ??
			freshId(`node`, `${level}:${reference.id}`, used)
		const group = groups.at(-1)
		if (group?.id === parent) group.references.push(reference)
		else groups.push({ id: parent, references: [reference] })
		currentParent = parent
	}
	const oldIds = new Set(oldNodes.map(({ id }) => id))
	const split: ReferenceGroup[] = []
	for (const group of groups) {
		if (
			oldIds.has(group.id) &&
			group.references.length <= limits.maximumChildrenPerNode
		) {
			split.push(group)
			continue
		}
		for (
			let start = 0;
			start < group.references.length;
			start += limits.targetChildrenPerNode
		) {
			const children = group.references.slice(
				start,
				start + limits.targetChildrenPerNode,
			)
			const id =
				start === 0
					? group.id
					: freshId(
							`node`,
							`${level}:${children.map(({ id: childId }) => childId).join(`:`)}`,
							used,
						)
			split.push({ id, references: children })
		}
	}
	for (let index = 0; index < split.length && split.length > 1; index++) {
		const group = split[index]
		if (group.references.length >= limits.minimumChildrenPerNode) continue
		const next = split[index + 1]
		const previousGroup = split[index - 1]
		if (
			next !== undefined &&
			group.references.length + next.references.length <=
				limits.maximumChildrenPerNode
		) {
			split.splice(index, 2, {
				id: group.id,
				references: [...group.references, ...next.references],
			})
			index--
		} else if (
			previousGroup !== undefined &&
			previousGroup.references.length + group.references.length <=
				limits.maximumChildrenPerNode
		) {
			split.splice(index - 1, 2, {
				id: previousGroup.id,
				references: [...previousGroup.references, ...group.references],
			})
			index -= 2
		}
	}
	return split
}

function buildNodes(
	leaves: readonly MosaicTextIndexLeaf[],
	previous: MosaicTextIndexBundle | undefined,
	limits: TextIndexLimits,
): { nodes: MosaicTextIndexNode[]; reference: MosaicTextIndexReference | null } {
	if (leaves.length === 0) return { nodes: [], reference: null }
	let references = leaves.map(referenceFor)
	const nodes: MosaicTextIndexNode[] = []
	const used = new Set(
		previous?.members
			.filter(({ kind }) => kind === `node`)
			.map(({ id }) => id) ?? [],
	)
	let level = 1
	while (references.length > 1) {
		const groups = packReferenceGroups(references, level, previous, limits, used)
		const levelNodes = groups.map<MosaicTextIndexNode>(
			({ id, references: children }) => ({
				children,
				id,
				kind: `node`,
				level,
				summary: summaryForReferences(children),
				version: 1,
			}),
		)
		nodes.push(...levelNodes)
		references = levelNodes.map(referenceFor)
		level++
	}
	return { nodes, reference: references[0] }
}

function leafRange(
	leaf: MosaicTextIndexLeaf,
	start: number,
): MosaicTextIndexRange {
	return {
		end: start + leaf.summary.utf16Units,
		kind: `utf16-range`,
		start,
	}
}

/** Stable atom-family key for bounded stale-leaf translation metadata. */
export function mosaicTextIndexAliasKey(source: string): string {
	// Leaf IDs are short, bounded physical identifiers. Retaining the source in
	// the durable key makes alias identity injective instead of trusting a
	// 32-bit hash to remain collision-free across a long-lived document.
	return `alias:${hashId(source)}:${source.length}:${source}`
}

function buildAliases(
	previous: MosaicTextIndexBundle | undefined,
	leaves: readonly MosaicTextIndexLeaf[],
	generation: number,
	limits: TextIndexLimits,
): MosaicTextIndexAlias[] {
	if (previous === undefined) return []
	const oldLeaves = priorLeaves(previous)
	const currentByUnit = new Map<string, string>()
	for (const leaf of leaves) {
		for (const unit of unitsFromFragments(leaf.fragments)) {
			currentByUnit.set(unitKey(unit), leaf.id)
		}
	}
	const fresh = new Map<string, MosaicTextIndexAlias>()
	let oldUtf16Start = 0
	for (const [oldIndex, oldLeaf] of oldLeaves.entries()) {
		const oldRange = leafRange(oldLeaf, oldUtf16Start)
		oldUtf16Start = oldRange.end
		const targets = new Set<string>()
		for (const unit of unitsFromFragments(oldLeaf.fragments)) {
			const target = currentByUnit.get(unitKey(unit))
			if (target !== undefined) targets.add(target)
		}
		if (targets.size === 0 && leaves.length > 0) {
			targets.add(leaves[Math.min(oldIndex, leaves.length - 1)].id)
		}
		if (targets.size === 1 && targets.has(oldLeaf.id)) continue
		const alias: MosaicTextIndexAlias = {
			generation,
			id: mosaicTextIndexAliasKey(oldLeaf.id),
			kind: `alias`,
			source: oldLeaf.id,
			version: 1,
			...(targets.size > 0 && targets.size <= limits.maximumAliasTargets
				? { targets: [...targets].sort() }
				: {
						recovery: {
							code: `range-resnapshot` as const,
							range: oldRange,
							reason: `alias-fanout` as const,
						},
					}),
		}
		fresh.set(alias.source, alias)
	}
	for (const member of previous.members) {
		if (
			member.kind !== `alias` ||
			generation - member.generation >= limits.maximumAliasGenerations ||
			fresh.has(member.source)
		) {
			continue
		}
		if (member.recovery !== undefined) {
			fresh.set(member.source, member)
			continue
		}
		const targets = new Set<string>()
		let recovery: MosaicTextIndexRecovery | undefined
		for (const target of member.targets ?? []) {
			const translated = fresh.get(target)
			if (translated?.recovery !== undefined) recovery = translated.recovery
			else if (translated?.targets !== undefined) {
				for (const resolved of translated.targets) targets.add(resolved)
			} else targets.add(target)
		}
		const translatedAlias: MosaicTextIndexAlias =
			recovery !== undefined || targets.size > limits.maximumAliasTargets
				? {
						...member,
						recovery:
							recovery ??
							({
								code: `range-resnapshot`,
								range: { end: 0, kind: `utf16-range`, start: 0 },
								reason: `alias-fanout`,
							} satisfies MosaicTextIndexRecovery),
					}
				: { ...member, targets: [...targets].sort() }
		fresh.set(member.source, translatedAlias)
	}
	return [...fresh.values()].sort((left, right) =>
		left.source.localeCompare(right.source),
	)
}

function buildIndex(
	fragments: readonly MosaicTextIndexFragment[],
	previous: MosaicTextIndexBundle | undefined,
	options: MosaicTextIndexOptions,
): MosaicTextIndexBundle {
	const limits = textIndexLimits(options)
	const leaves = partitionLeaves(fragments, previous, limits)
	const { nodes, reference } = buildNodes(leaves, previous, limits)
	const generation = (previous?.root.generation ?? -1) + 1
	const aliases = buildAliases(previous, leaves, generation, limits)
	return {
		members: [...leaves, ...nodes, ...aliases],
		root: { generation, id: `root`, kind: `root`, reference, version: 1 },
	}
}

/** Convert a run-text checkpoint into stable logical fragments for indexing. */
export function mosaicTextIndexFragments(
	snapshot: MosaicTextSnapshot,
): MosaicTextIndexFragment[] {
	return visibleMosaicTextRuns(snapshot).map(({ id, start, text }) => ({
		runId: id,
		start,
		text,
	}))
}

/** Build the first bounded-fanout index checkpoint. */
export function createMosaicTextIndex(
	fragments: readonly MosaicTextIndexFragment[],
	options: MosaicTextIndexOptions = {},
): MosaicTextIndexBundle {
	return buildIndex(fragments, undefined, options)
}

function memberMap(
	bundle: MosaicTextIndexBundle,
): Map<string, MosaicTextIndexMember> {
	return new Map(bundle.members.map((member) => [member.id, member]))
}

function sameSummary(
	left: MosaicTextIndexSummary,
	right: MosaicTextIndexSummary,
): boolean {
	return (
		left.graphemes === right.graphemes &&
		left.leafCount === right.leafCount &&
		left.lineBreaks === right.lineBreaks &&
		left.utf16Units === right.utf16Units
	)
}

function sameReference(
	left: MosaicTextIndexReference | null,
	right: MosaicTextIndexReference | null,
): boolean {
	return (
		left === right ||
		(left !== null &&
			right !== null &&
			left.id === right.id &&
			left.kind === right.kind &&
			sameSummary(left.summary, right.summary))
	)
}

function sameRecovery(
	left: MosaicTextIndexRecovery | undefined,
	right: MosaicTextIndexRecovery | undefined,
): boolean {
	return (
		left === right ||
		(left !== undefined &&
			right !== undefined &&
			left.code === right.code &&
			left.reason === right.reason &&
			left.range.kind === right.range.kind &&
			left.range.start === right.range.start &&
			left.range.end === right.range.end)
	)
}

function sameStrings(
	left: readonly string[] | undefined,
	right: readonly string[] | undefined,
): boolean {
	return (
		left === right ||
		(left !== undefined &&
			right !== undefined &&
			left.length === right.length &&
			left.every((value, index) => value === right[index]))
	)
}

function sameMember(
	left: MosaicTextIndexMember | undefined,
	right: MosaicTextIndexMember,
): boolean {
	if (left === undefined || left.kind !== right.kind || left.id !== right.id) {
		return false
	}
	if (left.kind === `alias` && right.kind === `alias`) {
		return (
			left.generation === right.generation &&
			left.source === right.source &&
			sameRecovery(left.recovery, right.recovery) &&
			sameStrings(left.targets, right.targets)
		)
	}
	if (left.kind === `leaf` && right.kind === `leaf`) {
		return (
			sameSummary(left.summary, right.summary) &&
			left.fragments.length === right.fragments.length &&
			left.fragments.every((value, index) => {
				const candidate = right.fragments[index]
				return (
					value.runId === candidate.runId &&
					value.start === candidate.start &&
					value.text === candidate.text
				)
			})
		)
	}
	if (left.kind === `node` && right.kind === `node`) {
		return (
			left.level === right.level &&
			sameSummary(left.summary, right.summary) &&
			left.children.length === right.children.length &&
			left.children.every((value, index) =>
				sameReference(value, right.children[index]),
			)
		)
	}
	return false
}

function sameRoot(
	left: MosaicTextIndexRoot,
	right: MosaicTextIndexRoot,
): boolean {
	return (
		left.generation === right.generation &&
		sameReference(left.reference, right.reference)
	)
}

function fitsHardLimits(
	bundle: MosaicTextIndexBundle,
	limits: TextIndexLimits,
): boolean {
	return bundle.members.every((member) => {
		if (member.kind === `leaf`) {
			return (
				member.summary.graphemes <= limits.maximumLeafGraphemes &&
				member.summary.utf16Units <= limits.maximumLeafUtf16Units &&
				member.fragments.length <= limits.maximumFragmentsPerLeaf
			)
		}
		if (member.kind === `node`) {
			return member.children.length <= limits.maximumChildrenPerNode
		}
		return (
			(member.targets?.length ?? 0) <= limits.maximumAliasTargets &&
			bundle.root.generation - member.generation < limits.maximumAliasGenerations
		)
	})
}

/**
 * Reconcile physical leaves while retaining boundaries inside the configured
 * hysteresis window. The returned writes form one actor-history-free Domain
 * maintenance batch; consumers submit them atomically beside a text gesture.
 */
export function maintainMosaicTextIndex(
	previous: MosaicTextIndexBundle,
	fragments: readonly MosaicTextIndexFragment[],
	options: MosaicTextIndexOptions = {},
): MosaicTextIndexMaintenanceResult {
	// Options remain part of the maintenance contract even for replay. This also
	// lets an operator tighten hard limits without first manufacturing a text edit.
	const limits = textIndexLimits(options)
	// Accepted duplicate delivery and restart replay do not manufacture a new
	// physical generation when the logical sequence is already indexed within
	// the currently configured hard bounds.
	const currentUnits = priorLeaves(previous).flatMap((leaf) =>
		unitsFromFragments(leaf.fragments),
	)
	const nextUnits = unitsFromFragments(fragments)
	if (
		currentUnits.length === nextUnits.length &&
		fitsHardLimits(previous, limits) &&
		currentUnits.every(
			(unit, index) =>
				unitKey(unit) === unitKey(nextUnits[index]) &&
				unit.text === nextUnits[index].text,
		)
	) {
		return {
			counters: {
				aliasesWritten: 0,
				leavesWritten: 0,
				membersRemoved: 0,
				nodesWritten: 0,
				rootWritten: 0,
			},
			index: previous,
			maintenance: {
				history: `exclude`,
				kind: `maintenance`,
				remove: [],
				root: null,
				upsert: [],
			},
		}
	}
	const index = buildIndex(fragments, previous, options)
	const before = memberMap(previous)
	const after = memberMap(index)
	const upsert = index.members.filter(
		(member) => !sameMember(before.get(member.id), member),
	)
	const remove = [...before.keys()]
		.filter((id) => !after.has(id))
		.sort((left, right) => left.localeCompare(right))
	const rootChanged = !sameRoot(previous.root, index.root)
	const maintenance: MosaicTextIndexMaintenance = {
		history: `exclude`,
		kind: `maintenance`,
		remove,
		root: rootChanged ? index.root : null,
		upsert,
	}
	return {
		counters: {
			aliasesWritten: upsert.filter(({ kind }) => kind === `alias`).length,
			leavesWritten: upsert.filter(({ kind }) => kind === `leaf`).length,
			membersRemoved: remove.length,
			nodesWritten: upsert.filter(({ kind }) => kind === `node`).length,
			rootWritten: rootChanged ? 1 : 0,
		},
		index,
		maintenance,
	}
}

export type MosaicTextIndexedGesture<Operation> = {
	readonly gestureId: string
	readonly maintenance: MosaicTextIndexMaintenance
	readonly operations: readonly Operation[]
}

/** Keep cross-leaf model operations and index maintenance in one Domain gesture. */
export function composeMosaicTextIndexedGesture<Operation>(options: {
	readonly gestureId: string
	readonly maintenance: MosaicTextIndexMaintenance
	readonly operations: readonly Operation[]
}): MosaicTextIndexedGesture<Operation> {
	if (options.gestureId.length === 0) {
		throw new Error(`A Mosaic text index gesture ID cannot be empty`)
	}
	return {
		gestureId: options.gestureId,
		maintenance: options.maintenance,
		operations: [...options.operations],
	}
}

export type MosaicTextIndexSource = {
	readonly read: (id: string) => Promise<MosaicTextIndexMember | undefined>
	readonly root: () => Promise<MosaicTextIndexRoot>
}

export type MosaicTextIndexReadCounters = {
	readonly aliases: number
	readonly leaves: number
	readonly nodes: number
	readonly roots: number
}

export type MosaicTextIndexLookup = {
	readonly globalGrapheme: number
	readonly globalLine: number
	readonly globalUtf16: number
	readonly leafId: string
	readonly position: MosaicTextRelativePosition
}

export type MosaicTextIndexRangeResult =
	| {
			readonly leafIds: readonly string[]
			readonly status: `ok`
	  }
	| {
			readonly recovery: MosaicTextIndexRecovery
			readonly status: `resnapshot`
	  }

/** Structured recovery signal for a residency range adapter. */
export class MosaicTextIndexRangeRecoveryError extends Error {
	public readonly recovery: MosaicTextIndexRecovery

	public constructor(recovery: MosaicTextIndexRecovery) {
		super(`Mosaic text range requires ${recovery.code}: ${recovery.reason}`)
		this.name = `MosaicTextIndexRangeRecoveryError`
		this.recovery = structuredClone(recovery)
	}
}

export type MosaicTextIndexReader = {
	readonly counters: MosaicTextIndexReadCounters
	positionAtGrapheme(offset: number): Promise<MosaicTextIndexLookup>
	positionAtLine(line: number): Promise<MosaicTextIndexLookup>
	positionAtOffset(offset: number): Promise<MosaicTextIndexLookup>
	resolveAlias(
		id: string,
		range?: MosaicTextIndexRange,
	): Promise<
		| { readonly leafIds: readonly string[]; readonly status: `ok` }
		| {
				readonly recovery: MosaicTextIndexRecovery
				readonly status: `resnapshot`
		  }
	>
	resolveRange(
		range: MosaicTextIndexRange,
		limit: number,
	): Promise<MosaicTextIndexRangeResult>
}

type MutableReadCounters = {
	aliases: number
	leaves: number
	nodes: number
	roots: number
}

type Metric = `graphemes` | `lineBreaks` | `utf16Units`

type LocatedLeaf = {
	readonly before: MosaicTextIndexSummary
	readonly leaf: MosaicTextIndexLeaf
}

function assertOffset(value: number, maximum: number, name: string): void {
	if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
		throw new RangeError(`${name} is outside the Mosaic text index`)
	}
}

function positionAtLeafMetric(
	leaf: MosaicTextIndexLeaf,
	metric: Metric,
	value: number,
): { position: MosaicTextRelativePosition; prefix: MosaicTextIndexSummary } {
	const units = unitsFromFragments(leaf.fragments)
	let prefix = emptySummary()
	if (units.length === 0) {
		return {
			position: { affinity: `left`, offset: 0, runId: null },
			prefix,
		}
	}
	if (metric === `lineBreaks` && value === 0) {
		return {
			position: {
				affinity: `right`,
				offset: units[0].start,
				runId: units[0].runId,
			},
			prefix,
		}
	}
	for (const unit of units) {
		const unitSummary = summaryForUnits([unit])
		const amount = unitSummary[metric]
		if (metric === `lineBreaks`) {
			if (value <= prefix.lineBreaks + amount && amount > 0) {
				return {
					position: {
						affinity: `left`,
						offset: unit.start + 1,
						runId: unit.runId,
					},
					prefix: addSummary(prefix, unitSummary),
				}
			}
		} else {
			const consumed = prefix[metric]
			if (value <= consumed) {
				return {
					position: {
						affinity: `right`,
						offset: unit.start,
						runId: unit.runId,
					},
					prefix,
				}
			}
			if (value < consumed + amount) {
				return {
					position: {
						affinity: `left`,
						offset: unit.start + 1,
						runId: unit.runId,
					},
					prefix: addSummary(prefix, unitSummary),
				}
			}
		}
		prefix = addSummary(prefix, unitSummary)
	}
	const last = units.at(-1)!
	return {
		position: { affinity: `left`, offset: last.start + 1, runId: last.runId },
		prefix,
	}
}

/** Read logarithmic paths and bounded ranges from separately persisted members. */
export function createMosaicTextIndexReader(
	source: MosaicTextIndexSource,
): MosaicTextIndexReader {
	const counters: MutableReadCounters = {
		aliases: 0,
		leaves: 0,
		nodes: 0,
		roots: 0,
	}
	const readRoot = async (): Promise<MosaicTextIndexRoot> => {
		counters.roots++
		const root = await source.root()
		if (root.kind !== `root` || root.version !== 1) {
			throw new Error(`Invalid Mosaic text index root`)
		}
		return root
	}
	const readOptionalMember = async (
		id: string,
	): Promise<MosaicTextIndexMember | undefined> => {
		const member = await source.read(id)
		if (member === undefined) return undefined
		if (member.id !== id || member.version !== 1) {
			throw new Error(`Missing Mosaic text index member: ${id}`)
		}
		if (member.kind === `leaf`) counters.leaves++
		else if (member.kind === `node`) counters.nodes++
		else counters.aliases++
		return member
	}
	const readMember = async (id: string): Promise<MosaicTextIndexMember> => {
		const member = await readOptionalMember(id)
		if (member === undefined) {
			throw new Error(`Missing Mosaic text index member: ${id}`)
		}
		return member
	}
	const locate = async (metric: Metric, value: number): Promise<LocatedLeaf> => {
		const root = await readRoot()
		const maximum = root.reference?.summary[metric] ?? 0
		assertOffset(value, maximum, metric)
		if (root.reference === null) {
			throw new Error(`The Mosaic text index is empty`)
		}
		let reference = root.reference
		let remaining = value
		let before = emptySummary()
		while (reference.kind === `node`) {
			const member = await readMember(reference.id)
			if (member.kind !== `node`) {
				throw new Error(`Mosaic text index reference kind mismatch`)
			}
			let selected = member.children.at(-1)
			for (const child of member.children) {
				const amount = child.summary[metric]
				if (remaining <= amount) {
					selected = child
					break
				}
				remaining -= amount
				before = addSummary(before, child.summary)
			}
			if (selected === undefined) throw new Error(`Empty Mosaic text index node`)
			reference = selected
		}
		const member = await readMember(reference.id)
		if (member.kind !== `leaf`) {
			throw new Error(`Mosaic text index reference kind mismatch`)
		}
		return { before, leaf: member }
	}
	const lookup = async (
		metric: Metric,
		value: number,
	): Promise<MosaicTextIndexLookup> => {
		const located = await locate(metric, value)
		const local = value - located.before[metric]
		const result = positionAtLeafMetric(located.leaf, metric, local)
		return {
			globalGrapheme: located.before.graphemes + result.prefix.graphemes,
			globalLine: located.before.lineBreaks + result.prefix.lineBreaks,
			globalUtf16: located.before.utf16Units + result.prefix.utf16Units,
			leafId: located.leaf.id,
			position: result.position,
		}
	}
	const resolveRange = async (
		range: MosaicTextIndexRange,
		limit: number,
	): Promise<MosaicTextIndexRangeResult> => {
		if (
			range.kind !== `utf16-range` ||
			!Number.isSafeInteger(range.start) ||
			!Number.isSafeInteger(range.end) ||
			range.start < 0 ||
			range.end < range.start ||
			!Number.isSafeInteger(limit) ||
			limit < 1
		) {
			throw new RangeError(`Invalid Mosaic text index range`)
		}
		const root = await readRoot()
		const total = root.reference?.summary.utf16Units ?? 0
		assertOffset(range.end, total, `range end`)
		if (root.reference === null) return { leafIds: [], status: `ok` }
		// Ranges are half-open. A collapsed caret range selects the character to
		// its right, except at EOF where it selects the final containing leaf.
		const collapsed = range.start === range.end
		const queryStart =
			collapsed && range.start === total
				? Math.max(0, range.start - 1)
				: range.start
		const queryEnd = collapsed ? Math.min(total, queryStart + 1) : range.end
		const leafIds: string[] = []
		const visit = async (
			reference: MosaicTextIndexReference,
			start: number,
		): Promise<void> => {
			if (leafIds.length > limit) return
			const end = start + reference.summary.utf16Units
			if (end <= queryStart || start >= queryEnd) return
			if (reference.kind === `leaf`) {
				leafIds.push(reference.id)
				return
			}
			const member = await readMember(reference.id)
			if (member.kind !== `node`) {
				throw new Error(`Mosaic text index reference kind mismatch`)
			}
			let childStart = start
			for (const child of member.children) {
				await visit(child, childStart)
				childStart += child.summary.utf16Units
				if (leafIds.length > limit) return
			}
		}
		await visit(root.reference, 0)
		if (leafIds.length > limit) {
			return {
				recovery: {
					code: `range-resnapshot`,
					range,
					reason: `range-member-limit`,
				},
				status: `resnapshot`,
			}
		}
		return { leafIds, status: `ok` }
	}
	return {
		counters,
		positionAtGrapheme: (offset) => lookup(`graphemes`, offset),
		positionAtLine: (line) => lookup(`lineBreaks`, line),
		positionAtOffset: (offset) => lookup(`utf16Units`, offset),
		async resolveAlias(id, range = { end: 0, kind: `utf16-range`, start: 0 }) {
			if (
				range.kind !== `utf16-range` ||
				!Number.isSafeInteger(range.start) ||
				!Number.isSafeInteger(range.end) ||
				range.start < 0 ||
				range.end < range.start
			) {
				throw new RangeError(`Invalid Mosaic text index range`)
			}
			const member = await readOptionalMember(mosaicTextIndexAliasKey(id))
			if (member === undefined) {
				return {
					recovery: {
						code: `range-resnapshot`,
						range,
						reason: `alias-missing`,
					},
					status: `resnapshot`,
				}
			}
			if (member.kind !== `alias` || member.source !== id) {
				throw new Error(`Mosaic text index alias mismatch`)
			}
			if (member.recovery !== undefined) {
				return { recovery: member.recovery, status: `resnapshot` }
			}
			return { leafIds: member.targets ?? [], status: `ok` }
		},
		resolveRange,
	}
}

/** Create a loader over an in-memory bundle for tests and storage adapters. */
export function mosaicTextIndexSource(
	bundle: MosaicTextIndexBundle,
): MosaicTextIndexSource {
	const members = memberMap(bundle)
	return {
		read: (id) => Promise.resolve(members.get(id)),
		root: () => Promise.resolve(bundle.root),
	}
}
