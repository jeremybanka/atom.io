import { type CellSnapshot, readSnapshot, validateId } from "./schema.ts"

/** This static fixture transport does not harvest Astro's data-resumption seeds. */
export function readCell(document: Document, id: string): CellSnapshot {
	validateId(id)
	const script = document.getElementById(`resume-state-${id}`)
	if (
		script?.localName !== `script` ||
		script.getAttribute(`type`) !== `application/json`
	)
		throw new Error(`resume: missing cell ${id}`)
	return readSnapshot(script.textContent ?? ``)
}
/** Resolve dedicated text containers without knowing their renderer or state engine. */
export function textTargets(document: Document, snapshot: CellSnapshot): Text[] {
	return snapshot.text.map((id) => {
		const target = document.getElementById(id)
		if (!target || target.children.length > 0)
			throw new Error(`resume: invalid text target ${id}`)
		const text = Array.from(target.childNodes).filter(
			(node) => node.nodeType === 3,
		)
		if (text.length !== 1 || target.textContent !== String(snapshot.value))
			throw new Error(`resume: stale text target ${id}`)
		return text[0] as Text
	})
}
