import type { EcologySnapshot } from "./ecology.ts"
import {
	addSearchDocument,
	indexStateSearch,
	type RawField,
	type SearchCapture,
	type SearchIndex,
} from "./search.ts"

/** Only detached snapshot metadata is admitted. Values and application tokens are never inspected. */
export function* indexEcologySearch(
	snapshot: EcologySnapshot,
): Generator<void, SearchIndex> {
	const capture: SearchCapture = {
		documents: [],
		capturedAt: Date.now(),
		partial: Object.values(snapshot.truncated).some(Boolean),
		truncatedText: 0,
		characters: 0,
		snapshotWork: snapshot.work,
	}
	const documents: SearchIndex[`documents`] = []
	let truncatedText = 0
	// Release copied raw fields as each batch is normalized instead of retaining two complete indexes.
	function* flush(): Generator<void> {
		const indexed = yield* indexStateSearch(capture)
		truncatedText += indexed.truncatedText
		for (const document of indexed.documents) {
			documents.push(document)
			yield
		}
		capture.documents = []
	}
	for (const family of snapshot.families) {
		addSearchDocument(
			capture,
			{
				id: `family:${family.key}`,
				key: family.key,
				family: null,
				kind: `family`,
				detail: family.type,
			},
			[
				{ kind: `key`, text: family.key },
				{ kind: `metadata`, text: family.type },
			],
		)
		if (capture.documents.length === 64) yield* flush()
		yield
	}
	for (const node of snapshot.nodes) {
		const fields: RawField[] = [{ kind: `key`, text: node.key }]
		if (node.family)
			fields.push(
				{ kind: `key`, text: node.family.subKey },
				{ kind: `family`, text: node.family.key },
			)
		const detail = `${node.type} · ${node.value.status === `cached` ? `cached ${node.value.type}` : `not cached / unknown`}`
		fields.push({ kind: `metadata`, text: detail })
		addSearchDocument(
			capture,
			{
				id: `state:${node.key}`,
				key: node.key,
				family: node.family?.key ?? null,
				kind: node.kind,
				detail,
			},
			fields,
		)
		if (capture.documents.length === 64) yield* flush()
		yield
	}
	yield* flush()
	return { ...capture, documents, truncatedText }
}
