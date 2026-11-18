import { Silo } from "atom.io"
import { expect, it, vi } from "vitest"

import { captureEcologySnapshot, type EcologySnapshot } from "../src/ecology.ts"
import { createGraphContext, projectEcology } from "../src/ecology-graph.ts"
import { indexEcologySearch } from "../src/ecology-search.ts"
import { matchStateSearch } from "../src/search.ts"

function drain<T>(iterator: Generator<void, T>): T {
	let next = iterator.next()
	while (!next.done) next = iterator.next()
	return next.value
}
const fixture = () =>
	new Silo({ name: `ecology-search`, lifespan: `ephemeral`, isProduction: true })
it(`ranks normalized keys, families, subkeys, token types and cached kinds using only detached metadata`, () => {
	const app = fixture(),
		trap = vi.fn(() => {
			throw new Error(`application value inspected`)
		})
	const checkoutTotalAtom = app.atom<unknown>({
		key: `checkoutTotal`,
		default: null,
	})
	app.store.valueMap.set(
		checkoutTotalAtom.key,
		new Proxy({}, { get: trap, ownKeys: trap, getPrototypeOf: trap }),
	)
	app.atom<number>({ key: `myCheckoutTotal`, default: trap })
	app.selector<number>({ key: `dormant`, get: trap })
	const catalogAtoms = app.atomFamily<number, string>({
		key: `catalog`,
		default: trap,
	})
	app.store.families.get(catalogAtoms.key)!.create(`ＧＲＥＥＮ`)
	const snapshot = captureEcologySnapshot(app.store),
		index = drain(indexEcologySearch(snapshot))
	for (const query of [
		`checkout total`,
		`CHECKOUTTOTAL`,
		`ｃｈｅｃｋｏｕｔｔｏｔａｌ`,
	])
		expect(drain(matchStateSearch(index, query)).hits[0].document.key).toBe(
			`checkoutTotal`,
		)
	for (const query of [
		`green`,
		`catalog green`,
		`readonly_pure_selector`,
		`cached object`,
		`checkuotTotal`,
	])
		expect(drain(matchStateSearch(index, query)).matching).toBeGreaterThan(0)
	expect(
		drain(matchStateSearch(index, `application value inspected`)).matching,
	).toBe(0)
	expect(
		index.documents.every((doc) =>
			doc.fields.every((field) => field.kind !== `value`),
		),
	).toBe(true)
	expect(trap).not.toHaveBeenCalled()
	app.atom<number>({ key: `later`, default: 0 })
	expect(drain(matchStateSearch(index, `later`)).matching).toBe(0)
})

it(`keeps full matching counts separate from100 ranked results and500 painted nodes; selected late matches remain reachable`, () => {
	const app = fixture()
	for (let i = 0; i < 750; i++) {
		const options = { key: `product${i}`, default: 0 }
		app.atom<number>(options)
	}
	const snapshot = captureEcologySnapshot(app.store, { maxNodes: 1000 }),
		index = drain(indexEcologySearch(snapshot)),
		ids = new Set<string>()
	const result = drain(matchStateSearch(index, `product`, 2_000_000, ids))
	expect(result.matching).toBe(750)
	expect(result.hits).toHaveLength(100)
	expect(ids.size).toBe(750)
	const context = createGraphContext()
	context.query = `product`
	context.selected = `state:product749`
	const projected = drain(projectEcology(snapshot, context, ids))
	expect(projected.matching).toBe(750)
	expect(projected.items).toHaveLength(500)
	expect(projected.items.some((item) => item.id === context.selected)).toBe(true)
	const second = drain(projectEcology(snapshot, context, ids))
	expect(second.items.some((item) => item.id === context.selected)).toBe(true)
	expect(second.newPositions).toBe(0)
})

it(`bounds copied text/normalization and reports snapshot and text omissions`, () => {
	const app = fixture(),
		options = { key: `x`.repeat(10_000), default: 0 }
	app.atom<number>(options)
	const snapshot = captureEcologySnapshot(app.store)
	const partial: EcologySnapshot = {
		...snapshot,
		truncated: { nodes: true, families: false, relations: false },
	}
	const indexed = drain(indexEcologySearch(partial))
	expect(indexed.partial).toBe(true)
	expect(indexed.truncatedText).toBeGreaterThan(0)
	expect(indexed.documents[0].fields[0].text.length).toBeLessThanOrEqual(1024)
	expect(drain(matchStateSearch(indexed, `x`.repeat(257))).validation).toContain(
		`256`,
	)
	expect(
		drain(matchStateSearch(indexed, `notfound`, 0)).approximateLimited,
	).toBe(true)
})

it(`pins selected matches beyond the paint cap without moving positions already assigned to other records`, () => {
	const app = fixture()
	for (let i = 0; i < 501; i++) {
		const options = { key: `row${i}`, default: 0 }
		app.atom<number>(options)
	}
	const snapshot = captureEcologySnapshot(app.store),
		context = createGraphContext()
	drain(projectEcology(snapshot, context))
	const first = context.positions.get(`state:row0`)
	context.selected = `state:row500`
	const next = drain(projectEcology(snapshot, context))
	expect(next.items).toHaveLength(500)
	expect(next.items[499].id).toBe(`state:row500`)
	expect(context.positions.get(`state:row0`)).toBe(first)
})

it(`reuses immutable graph metadata only within the same capture and keeps canceled positioning private`, () => {
	const app = fixture()
	for (let i = 0; i < 501; i++) {
		const options = { key: `node${i}`, default: 0 }
		app.atom<number>(options)
	}
	const snapshot = captureEcologySnapshot(app.store),
		context = createGraphContext()
	const first = drain(projectEcology(snapshot, context))
	const second = drain(projectEcology(snapshot, context, undefined, first))
	expect(second.all.get(`state:node0`)).toBe(first.all.get(`state:node0`))
	context.selected = `state:node500`
	const canceled = projectEcology(snapshot, context, undefined, second)
	for (let i = 0; i < 501; i++) canceled.next()
	canceled.return(undefined as never)
	expect(context.positions.has(`state:node500`)).toBe(false)
	expect(second.all.get(`state:node500`)!.x).toBe(0)
	const next = drain(projectEcology(snapshot, context, undefined, second))
	expect(next.all.get(`state:node500`)!.x).not.toBe(0)
	expect(second.all.get(`state:node500`)!.x).toBe(0)
	const refreshed = drain(
		projectEcology(captureEcologySnapshot(app.store), context, undefined, next),
	)
	expect(refreshed.all.get(`state:node0`)).not.toBe(next.all.get(`state:node0`))
})
