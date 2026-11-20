import { Silo } from "atom.io"
import { expect, it, vi } from "vitest"

import { captureEcologySnapshot } from "../src/ecology.ts"
import { indexEcologySearch } from "../src/ecology-search.ts"
import { matchStateSearch } from "../src/search.ts"

function finish<T>(iterator: Generator<void, T>): T {
	let step = iterator.next()
	while (!step.done) step = iterator.next()
	return step.value
}
const fixture = () =>
	new Silo({ name: `search`, lifespan: `ephemeral`, isProduction: true })
const index = (silo: Silo) =>
	finish(indexEcologySearch(captureEcologySnapshot(silo.store)))

it(`ranks full keys, words, prefixes, substrings and one-edit matches`, () => {
	const silo = fixture()
	for (const [key, value] of [
		[`unrelated`, `cartQuantity`],
		[`cartQuantityBySku`, ``],
		[`cartQuantity`, ``],
		[`otherCartQuantity`, ``],
		[`orderTotal`, ``],
		[`fulfillment`, ``],
	]) {
		silo.atom<unknown>({ key, default: `` })
		silo.store.valueMap.set(key, value)
	}
	const snapshot = index(silo)
	expect(
		finish(matchStateSearch(snapshot, `cartQuantity`)).hits.map(
			(hit) => hit.document.key,
		),
	).toEqual([`cartQuantity`, `cartQuantityBySku`, `otherCartQuantity`])
	expect(
		finish(matchStateSearch(snapshot, `cart quan`)).hits.map(
			(hit) => hit.document.key,
		),
	).toContain(`cartQuantity`)
	for (const query of [
		`oder totl`,
		`orderTotla`,
		`orderTotall`,
		`orderTtal`,
		`fulfilment`,
	]) {
		const result = finish(matchStateSearch(snapshot, query))
		expect(result.hits.length, query).toBeGreaterThan(0)
		expect(result.hits[0].approximate, query).toBe(true)
	}
	expect(finish(matchStateSearch(snapshot, `zz`)).hits).toEqual([])
	const limited = finish(matchStateSearch(snapshot, `cartQuantitz`, 0))
	expect(limited.approximateLimited).toBe(true)
	expect(limited.comparisons).toBe(0)
	expect(
		finish(matchStateSearch(snapshot, `cartQuantity`, 1)).hits.some(
			(hit) => hit.document.key === `cartQuantity`,
		),
	).toBe(true)
})

it(`retains the best 100 with stable order when better names arrive after the cap, while counting every match`, () => {
	const silo = fixture()
	for (let i = 0; i < 120; i++)
		silo.atom<number>({ key: `cartQuantityBySku${i}`, default: 0 })
	silo.atom<number>({ key: `cartQuantity`, default: 0 })
	const result = finish(matchStateSearch(index(silo), `cartQuantity`))
	expect(result.matching).toBe(121)
	expect(result.hits.map((hit) => hit.document.key)).toEqual([
		`cartQuantity`,
		...Array.from({ length: 99 }, (_, i) => `cartQuantityBySku${i}`),
	])
})

it(`projects ASCII spans without constructing a cold native segmenter, resetting shared marks between hits`, () => {
	const silo = fixture()
	for (const key of [`xxMATCHxxMATCH`, `MATCH`, `nothing`])
		silo.atom<number>({ key, default: 0 })
	const snapshot = index(silo)
	const segmenter = vi.spyOn(Intl, `Segmenter`)
	try {
		const result = finish(matchStateSearch(snapshot, `match`))
		expect(
			result.hits.find((hit) => hit.document.key === `xxMATCHxxMATCH`)!.ranges,
		).toEqual([
			[2, 7],
			[9, 14],
		])
		expect(
			result.hits.find((hit) => hit.document.key === `MATCH`)!.ranges,
		).toEqual([[0, 5]])
		expect(segmenter).not.toHaveBeenCalled()
	} finally {
		segmenter.mockRestore()
	}
})

it(`constructs one segmenter lazily for Unicode literal spans and shares it within a query`, () => {
	const silo = fixture()
	for (const key of [`café`, `café and café`])
		silo.atom<number>({ key, default: 0 })
	const snapshot = index(silo)
	const segmenter = vi.spyOn(Intl, `Segmenter`)
	try {
		const result = finish(matchStateSearch(snapshot, `café`))
		expect(result.hits.map((hit) => hit.ranges)).toEqual([
			[[0, 4]],
			[
				[0, 4],
				[9, 13],
			],
		])
		expect(segmenter).toHaveBeenCalledTimes(1)
	} finally {
		segmenter.mockRestore()
	}
})

it(`drops normalized words that cross the document bound after compatibility expansion`, () => {
	const silo = fixture(),
		key = `ﬃ`.repeat(1024)
	silo.atom<number>({ key, default: 0 })
	const document = index(silo).documents[0]
	expect(document.truncated).toBe(true)
	expect(document.fields[0].fold.length).toBe(2048)
	expect(document.fields[0].words).toEqual([])
})

it(`maps the complete UTF-16 span of a field at the normalized code-point limit`, () => {
	const silo = fixture(),
		key = `😀`.repeat(512) + `ﬃ`.repeat(512)
	silo.atom<number>({ key, default: 0 })
	const hit = finish(matchStateSearch(index(silo), `ffi`)).hits[0]
	expect([...hit.document.fields[0].fold]).toHaveLength(2048)
	expect(hit.document.fields[0].fold.length).toBe(2560)
	expect(hit.ranges).toEqual([[1024, 1536]])
})

it(`indexes punctuation-only terms across yield checkpoints`, () => {
	const silo = fixture()
	const key = `name/field a b c d e f g h i j k l m n hidden`
	silo.atom<number>({ key, default: 0 })
	let elapsed = 0
	const clock = vi.spyOn(performance, `now`).mockImplementation(() => elapsed++)
	try {
		const captured = index(silo)
		expect(finish(matchStateSearch(captured, `/`)).hits[0].document.key).toBe(
			key,
		)
		expect(finish(matchStateSearch(captured, `hidden`)).hits).toEqual([])
	} finally {
		clock.mockRestore()
	}
})
