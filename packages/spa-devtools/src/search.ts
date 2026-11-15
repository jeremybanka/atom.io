import type { RootStore } from "atom.io/internal"

import type { EcologyLimits, EcologySnapshot } from "./ecology.ts"
import { captureEcologySnapshot } from "./ecology.ts"

export type SearchView = `atoms` | `selectors`
type FieldKind = `key` | `family` | `metadata` | `value`
interface RawField {
	kind: FieldKind
	text: string
}
interface SearchDocument {
	id: string
	key: string
	family: string | null
	kind: `atom` | `selector` | `family`
	label: string
	detail: string
	value: `uncached` | `skipped` | `copied` | `family`
	truncated: boolean
	fields: RawField[]
}
export interface SearchCapture {
	documents: SearchDocument[]
	capturedAt: number
	partial: boolean
	truncatedText: number
	skippedValues: number
	uncachedValues: number
	characters: number
	snapshotWork: EcologySnapshot[`work`]
}
interface IndexedField extends RawField {
	fold: string
	words: string[]
}
interface IndexedDocument extends Omit<SearchDocument, `fields`> {
	fields: IndexedField[]
}
export interface SearchIndex extends Omit<SearchCapture, `documents`> {
	documents: IndexedDocument[]
}
export interface SearchHit {
	document: IndexedDocument
	valueMatch: boolean
	approximate: boolean
	ranges: readonly [number, number][]
	valueRanges: readonly [number, number][]
	score: readonly number[]
}
export interface SearchResults {
	hits: SearchHit[]
	matching: number
	comparisons: number
	approximateLimited: boolean
	validation: string
}
const FIELD_LIMIT = 1_024
const DOCUMENT_LIMIT = 2_048
const WORD_LIMIT = 16
const WORDS = /\p{Lu}?(?:\p{Ll}|\p{M})+|\p{Lu}+(?!\p{Ll})|\p{N}+/gu
const ASCII = /^\p{ASCII}*$/u
const fold = (text: string): string => text.normalize(`NFKC`).toLowerCase()

/** Inspect only the permitted prefix and one omission probe. Never normalize an unbounded string. */
function prefix(
	text: string,
	max: number,
): { text: string; omitted: boolean; work: number; length: number } {
	if (text.length <= max && ASCII.test(text))
		return { text, omitted: false, work: text.length, length: text.length }
	const chars: string[] = []
	let work = 0,
		omitted = false
	for (const char of text) {
		work++
		if (chars.length === max) {
			omitted = true
			break
		}
		chars.push(char)
	}
	return { text: chars.join(``), omitted, work, length: chars.length }
}

/** Atomic committed-root copy. Query work never reads this store again. */
export function captureStateSearch(
	store: RootStore,
	view: SearchView,
	limits: EcologyLimits = {},
): SearchCapture | null {
	if (store.on.transactionApplying.state !== null) return null
	const snapshot = captureEcologySnapshot(store, {
		maxNodes: 10_000,
		maxFamilies: 10_000,
		maxRelations: 50_000,
		...limits,
	})
	const result: SearchCapture = {
		documents: [],
		capturedAt: Date.now(),
		partial: Object.values(snapshot.truncated).some(Boolean),
		truncatedText: 0,
		skippedValues: 0,
		uncachedValues: 0,
		characters: 0,
		snapshotWork: snapshot.work,
	}
	const add = (
		document: Omit<SearchDocument, `fields` | `label` | `truncated`>,
		fields: RawField[],
	) => {
		let remaining = DOCUMENT_LIMIT,
			truncated = false
		const copied = fields.map((field) => {
			const bounded = prefix(field.text, Math.min(FIELD_LIMIT, remaining))
			remaining -= bounded.length
			result.characters += bounded.work
			truncated ||= bounded.omitted
			return { kind: field.kind, text: bounded.text }
		})
		result.truncatedText += Number(truncated)
		result.documents.push({
			...document,
			fields: copied,
			label: copied[0].text,
			truncated,
		})
	}
	for (const family of snapshot.families) {
		if ((view === `selectors`) !== family.type.includes(`selector`)) continue
		add(
			{
				id: `family:${family.key}`,
				key: family.key,
				family: family.key,
				kind: `family`,
				detail: `${family.type} · ${family.memberCount}${family.countComplete ? `` : `+`} members`,
				value: `family`,
			},
			[
				{ kind: `key`, text: family.key },
				{ kind: `metadata`, text: family.type },
			],
		)
	}
	for (const node of snapshot.nodes) {
		if ((view === `atoms`) !== (node.kind === `atom`)) continue
		const fields: RawField[] = [{ kind: `key`, text: node.key }]
		if (node.family) {
			// Bound each source independently; never concatenate arbitrarily large keys before copying.
			fields.push(
				{ kind: `key`, text: node.family.subKey },
				{ kind: `family`, text: node.family.key },
			)
		}
		const detail = `${node.type} · ${node.value.status === `cached` ? `cached ${node.value.type}` : `not cached / unknown`}`
		fields.push({
			kind: `metadata`,
			text: `${detail} ${node.type.startsWith(`readonly`) ? `readonly` : `writable`} ${node.dependencies}`,
		})
		let value: SearchDocument[`value`] = `uncached`
		if (store.valueMap.has(node.key)) {
			const cached: unknown = store.valueMap.get(node.key)
			if (
				cached === null ||
				cached === undefined ||
				typeof cached === `string` ||
				typeof cached === `number` ||
				typeof cached === `boolean`
			) {
				value = `copied`
				fields.push({ kind: `value`, text: String(cached) })
			} else {
				value = `skipped`
				result.skippedValues++
			}
		} else result.uncachedValues++
		add(
			{
				id: `state:${node.key}`,
				key: node.key,
				family: node.family?.key ?? null,
				kind: node.kind,
				detail,
				value,
			},
			fields,
		)
	}
	return result
}

/** Normalization is scheduled separately from the atomic store copy. */
export function* indexStateSearch(
	capture: SearchCapture,
): Generator<void, SearchIndex> {
	const documents: IndexedDocument[] = []
	let truncatedText = 0
	for (const document of capture.documents) {
		let remaining = WORD_LIMIT,
			normalizedRemaining = DOCUMENT_LIMIT,
			truncated = document.truncated
		const fields: IndexedField[] = []
		let checkpoint = performance.now()
		for (const field of document.fields) {
			let text = field.text
			const words: string[] = []
			WORDS.lastIndex = 0
			let match: RegExpExecArray | null
			while ((match = WORDS.exec(text))) {
				if (words.length === remaining) {
					text = text.slice(0, match.index)
					truncated = true
					break
				}
				words.push(fold(match[0]))
			}
			WORDS.lastIndex = 0
			remaining -= words.length
			const normalized = prefix(fold(text), normalizedRemaining)
			normalizedRemaining -= normalized.length
			truncated ||= normalized.omitted
			for (let i = words.length - 1; i >= 0; i--)
				if (!normalized.text.includes(words[i])) words.splice(i, 1)
			fields.push({ kind: field.kind, text, fold: normalized.text, words })
			if (performance.now() - checkpoint >= 1) {
				yield
				checkpoint = performance.now()
			}
		}
		truncatedText += Number(truncated)
		documents.push({ ...document, label: fields[0].text, fields, truncated })
		yield
	}
	return { ...capture, documents, truncatedText }
}

/** One insertion/deletion/substitution/transposition, with an actual character-comparison budget. */
function oneEdit(a: string, b: string, spend: () => boolean): boolean {
	if (Math.abs(a.length - b.length) > 1 || b.length > 64) return false
	let i = 0,
		j = 0,
		edits = 0
	while (i < a.length && j < b.length) {
		if (!spend()) return false
		if (a[i] === b[j]) {
			i++
			j++
			continue
		}
		if (edits++) return false
		if (a.length === b.length) {
			if (
				i + 1 < a.length &&
				spend() &&
				a[i] === b[j + 1] &&
				spend() &&
				a[i + 1] === b[j]
			) {
				i += 2
				j += 2
			} else {
				i++
				j++
			}
		} else if (a.length > b.length) i++
		else j++
	}
	return edits + Number(i < a.length || j < b.length) <= 1
}

function literalTier(field: IndexedField, token: string): number {
	if (field.words.includes(token)) return 1
	for (const word of field.words) if (word.startsWith(token)) return 2
	return field.fold.includes(token) ? 3 : 9
}
/** Mark literal normalized spans, then map only their graphemes back to original text. */
function* ranges(
	field: IndexedField,
	tokens: string[],
	mask: Uint8Array,
	getSegmenter: () => Intl.Segmenter,
): Generator<void, [number, number][]> {
	mask.fill(0, 0, field.fold.length)
	let end = 0
	for (const token of tokens) {
		let at = field.fold.indexOf(token)
		while (at !== -1) {
			mask.fill(1, at, at + token.length)
			end = Math.max(end, at + token.length)
			yield
			at = field.fold.indexOf(token, at + 1)
		}
	}
	if (!end) return []
	const merged: [number, number][] = []
	if (ASCII.test(field.text)) {
		for (let at = 0; at < end;) {
			if (!mask[at]) {
				at++
				continue
			}
			const start = at++
			while (at < end && mask[at]) at++
			merged.push([start, at])
			yield
		}
		return merged
	}
	let offset = 0
	for (const part of getSegmenter().segment(field.text)) {
		const next = offset + fold(part.segment).length
		let marked = false
		for (let at = offset; at < next; at++) marked ||= mask[at] === 1
		if (marked) {
			const prior = merged.at(-1)
			if (prior && prior[1] === part.index)
				prior[1] = part.index + part.segment.length
			else merged.push([part.index, part.index + part.segment.length])
		}
		offset = next
		yield
		if (offset >= end) break
	}
	return merged
}
function compareScore(a: readonly number[], b: readonly number[]): number {
	for (let i = 0; i < a.length - 1; i++) {
		const difference = a[i] - b[i]
		if (difference) return difference
	}
	return a[4] - b[4]
}

/** Pure, cancellable work over copied text only. Exact matching always completes despite a fuzzy cutoff. */
export function* matchStateSearch(
	index: SearchIndex,
	input: string,
	maxComparisons = 2_000_000,
): Generator<void, SearchResults> {
	const bounded = prefix(input, 256)
	const query = fold(bounded.text.trim())
	const tokens = [...bounded.text.trim().matchAll(WORDS)].map((match) =>
		fold(match[0]),
	)
	if (!tokens.length && query) tokens.push(query)
	if (bounded.omitted || tokens.length > 8)
		return {
			hits: [],
			matching: 0,
			comparisons: 0,
			approximateLimited: false,
			validation: `Use at most 256 characters and eight search words.`,
		}
	let comparisons = 0,
		approximateLimited = false
	const spend = () => {
		if (comparisons >= maxComparisons) {
			approximateLimited = true
			return false
		}
		comparisons++
		return true
	}
	const hits: SearchHit[] = []
	let matching = 0
	const score = [0, 0, 0, 0, 0]
	if (!query)
		return { hits, matching: 0, comparisons, approximateLimited, validation: `` }
	for (const document of index.documents) {
		let tier = 0,
			priority = 0,
			edits = 0,
			valueMatch = false,
			named = false,
			matches = true
		for (const token of tokens) {
			let best = 9,
				fieldPriority = 9
			for (let position = 0; position < document.fields.length; position++) {
				const field = document.fields[position]
				const literal = literalTier(field, token)
				if (literal < 9 && best === 9) {
					best = literal
					fieldPriority = position
				}
			}
			if (best === 9 && token.length >= 4 && token.length <= 64) {
				for (let position = 0; position < document.fields.length; position++) {
					const words = document.fields[position].words
					for (const word of words) {
						if (oneEdit(token, word, spend)) {
							best = 4
							fieldPriority = position
							break
						}
					}
					if (best === 4) break
				}
			}
			if (best === 9) {
				matches = false
				break
			}
			const field = document.fields[fieldPriority]
			valueMatch ||= field.kind === `value`
			named ||= field.kind === `key` || field.kind === `family`
			tier = Math.max(tier, best)
			priority += fieldPriority
			edits += Number(best === 4)
		}
		if (matches) {
			if (document.fields[0].fold === query) tier = 0
			// Retain only the best 100 in stable order. A full-result sort cannot be interrupted.
			score[0] = named ? 0 : valueMatch ? 2 : 1
			score[1] = tier
			score[2] = edits
			score[3] = priority
			score[4] = matching++
			let low = 0,
				high = hits.length
			while (low < high) {
				const middle = (low + high) >>> 1
				if (compareScore(score, hits[middle].score) < 0) high = middle
				else low = middle + 1
			}
			if (low < 100) {
				hits.splice(low, 0, {
					document,
					valueMatch,
					approximate: edits > 0,
					ranges: [],
					valueRanges: [],
					score: [...score],
				})
				if (hits.length > 100) hits.pop()
			}
		}
		yield
	}
	// The budget counts code points; match offsets use up to two UTF-16 units each.
	const mask = new Uint8Array(DOCUMENT_LIMIT * 2)
	let segmenter: Intl.Segmenter | undefined
	const getSegmenter = () =>
		(segmenter ??= new Intl.Segmenter(`en`, { granularity: `grapheme` }))
	for (const hit of hits) {
		hit.ranges = yield* ranges(
			hit.document.fields[0],
			tokens,
			mask,
			getSegmenter,
		)
		if (hit.valueMatch)
			hit.valueRanges = yield* ranges(
				hit.document.fields.find((field) => field.kind === `value`)!,
				tokens,
				mask,
				getSegmenter,
			)
		yield
	}
	return {
		hits,
		matching,
		comparisons,
		approximateLimited,
		validation: ``,
	}
}
