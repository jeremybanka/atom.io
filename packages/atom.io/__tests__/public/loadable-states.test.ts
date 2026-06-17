/* oxlint-disable typescript/only-throw-error */
/* oxlint-disable typescript/require-await */
import * as http from "node:http"

import type { Loadable } from "atom.io"
import {
	atom,
	atomFamily,
	getState,
	resetState,
	selector,
	setState,
	Silo,
	subscribe,
} from "atom.io"
import { parseJson } from "atom.io/foundations/json"
import { setTestLogLevel, takeSnapshot } from "atom.io/testing"

import * as Utils from "../__util__/index.ts"

const { restore } = takeSnapshot()

beforeEach(() => {
	restore()
	setTestLogLevel(null)
	vitest.spyOn(Utils, `stdout`).mockReset()
})

describe(`async atom`, async () => {
	it(`hits the subscriber twice`, async () => {
		const countAtom = atom<Loadable<number>>({
			key: `count`,
			default: 0,
		})
		subscribe(countAtom, (update) => {
			Utils.stdout(`count`, update)
		})
		const getNumber = async () => 1
		setState(countAtom, getNumber())
		const countValueInitial = getState(countAtom)
		expect(countValueInitial).toBeInstanceOf(Promise)
		const countValueAwaited = await getState(countAtom)
		expect(countValueAwaited).toBe(1)
		expect(Utils.stdout).toHaveBeenCalledTimes(2)
	})
	it(`handles a rejected promise`, async () => {
		const countAtom = atom<Loadable<number>>({
			key: `count`,
			default: 0,
		})
		subscribe(countAtom, ({ newValue, oldValue }) => {
			Utils.stdout(`count`, { newValue, oldValue })
		})
		const getNumber = async (): Promise<number> => {
			throw new Error(`😤`)
		}
		setState(countAtom, getNumber())
		const countValueInitial = getState(countAtom)
		expect(countValueInitial).toBeInstanceOf(Promise)

		expect(Utils.stdout).toHaveBeenCalledTimes(1)
	})
	test(`batch pre-loading`, async () => {
		const wastefulLoads: number[] = []

		const countAtoms = atomFamily<Loadable<number>, number>({
			key: `count`,
			default: () =>
				new Promise((resolve) => {
					setImmediate(() => {
						wastefulLoads.push(1)
						resolve(1)
					})
				}),
		})
		const countIdsAtom = atom<Loadable<number[]>>({
			key: `countIds`,
			default: async () =>
				new Promise((resolve) =>
					setImmediate(() => {
						const ids = [1, 2, 3]
						for (let i = 0; i < ids.length; i++) {
							setState(countAtoms, i, 1)
						}
						resolve(ids)
					}),
				),
		})

		const countIds = await getState(countIdsAtom)

		expect(countIds).toEqual([1, 2, 3])
		expect(wastefulLoads).toEqual([])
		expect(getState(countAtoms, 0)).toBe(1)
		expect(getState(countAtoms, 1)).toBe(1)
		expect(getState(countAtoms, 2)).toBe(1)
	})
})

describe(`async selector`, () => {
	const PORT = 3443
	const ORIGIN = `http://localhost:${PORT}`
	const server = http.createServer((req, res) => {
		let data: Uint8Array[] = []
		req
			.on(`data`, (chunk) => {
				data.push(chunk)
			})
			.on(`end`, () => {
				const authHeader = req.headers.authorization
				try {
					if (authHeader !== `Bearer MY_BEARER_TOKEN`) throw 401
					if (typeof req.url !== `string`) throw 418
					const url = new URL(req.url, ORIGIN)

					switch (req.method) {
						case `POST`: {
							const body = parseJson(Buffer.concat(data).toString())
							switch (url.pathname) {
								case `/divide`:
									if (
										typeof body === `object` &&
										body !== null &&
										`dividend` in body &&
										`divisor` in body &&
										typeof body[`dividend`] === `number` &&
										typeof body[`divisor`] === `number`
									) {
										const { dividend, divisor } = body
										const quotient =
											divisor === 0
												? dividend >= 0
													? `Infinity`
													: `-Infinity`
												: dividend / divisor

										res.writeHead(200, {
											"Content-Type": `application/json`,
										})
										res.end(
											JSON.stringify({
												quotient: quotient.toString(),
											}),
										)
									} else {
										throw 400
									}
									break
								default:
									throw 404
							}
							break
						}
						case undefined:
							throw 418
						default:
							throw 405
					}
				} catch (thrown) {
					if (typeof thrown === `number`) {
						res.writeHead(thrown)
						res.end()
					} else {
						throw thrown
					}
				} finally {
					data = []
				}
			})
	})
	server.listen(PORT)

	afterAll(() => {
		server.close()
	})

	test(`selector as a caching mechanism for async data`, async () => {
		const silo = new Silo({
			name: `math`,
			lifespan: `ephemeral`,
			isProduction: false,
		})
		// setLogLevel(`info`, store)
		const dividendAtom = silo.atom<number>({
			key: `dividend`,
			default: 0,
		})
		const divisorAtom = silo.atom<number>({
			key: `divisor`,
			default: 0,
		})
		const quotientSelector = silo.selector<
			Error | Promise<Error | number> | number
		>({
			key: `quotient`,
			get: async ({ get }) => {
				const dividend = get(dividendAtom)
				const divisor = get(divisorAtom)
				const response = await fetch(`${ORIGIN}/divide`, {
					method: `POST`,
					headers: {
						authorization: `Bearer MY_BEARER_TOKEN`,
					},
					body: JSON.stringify({ dividend, divisor }),
				})
				const json = await response.json()
				const { quotient } = json

				if (typeof quotient === `string`) {
					const parsed = Number.parseFloat(quotient)
					if (Number.isNaN(parsed)) return Error(`quotient is NaN`)
					return parsed
				}
				return Error(`quotient is not a string`)
			},
		})
		const quotient0 = silo.getState(quotientSelector)
		expect(quotient0).toBeInstanceOf(Promise)

		const quotient1 = await silo.getState(quotientSelector)

		expect(quotient1).toBe(Number.POSITIVE_INFINITY)

		const quotient2 = silo.getState(quotientSelector)
		expect(quotient2).toBe(Number.POSITIVE_INFINITY)
	})
})

describe(`downstream from async`, () => {
	test(`sync selector downstream from async atom`, async () => {
		const countAtom = atom<Loadable<number>>({
			key: `count`,
			default: () =>
				new Promise((resolve) =>
					setTimeout(() => {
						resolve(1)
					}, 10),
				),
		})
		const typeSelector = selector<string>({
			key: `type`,
			get: ({ get }) => {
				const count = get(countAtom)
				return typeof count
			},
		})
		const countLoadable = getState(countAtom)
		expect(countLoadable).toBeInstanceOf(Promise)

		expect(getState(typeSelector)).toBe(`object`)

		const count = await countLoadable
		expect(count).toBe(1)
		expect(getState(typeSelector)).toBe(`number`)
	})
	test(`sync selector downstream from async selector`, async () => {
		const countAtom = atom<number>({
			key: `count`,
			default: 2,
		})
		const doubledSelector = selector<Loadable<number>>({
			key: `doubled`,
			get: async ({ get }) => {
				const count = get(countAtom)
				const double = count * 2
				return double
			},
		})
		const typeSelector = selector<string>({
			key: `type`,
			get: ({ get }) => {
				const doubled = get(doubledSelector)
				return typeof doubled
			},
		})

		const doubledLoadable = getState(doubledSelector)
		expect(doubledLoadable).toBeInstanceOf(Promise)
		expect(getState(typeSelector)).toBe(`object`)

		const doubled = await doubledLoadable
		expect(doubled).toBe(4)

		expect(getState(typeSelector)).toBe(`number`)
	})
	test(`loadable index`, async () => {
		let loadOrgId = (_: number) => {
			console.warn(`loadOrgId not attached`)
		}

		const orgIdAtom = atom<Loadable<number>>({
			key: `orgId`,
			default: () => new Promise((resolve) => (loadOrgId = resolve)),
		})

		const loadIndex: Record<number, () => void> = {}
		const loadItems: Record<number, () => void> = {}

		const indexAtoms = atomFamily<Loadable<number[]>, number>({
			key: `index`,
			default: (key) =>
				new Promise((resolve) => {
					loadIndex[key] = () => {
						resolve([1, 2, 3])
					}
				}),
		})
		const itemAtoms = atomFamily<Loadable<{ data: string }>, number>({
			key: `item`,
			default: (key) =>
				new Promise<{ data: string }>((resolve) => {
					loadItems[key] = () => {
						resolve({ data: `${key}`.repeat(3) })
					}
				}),
		})

		let idx = 0
		const allItemsSelector = selector<Loadable<{ data: string }[]>>({
			key: `allItems`,
			get: async ({ get }) => {
				const i = idx++
				const orgId = await get(orgIdAtom)
				// console.log(i, `👀 iod`, orgId)
				const index = get(indexAtoms, orgId)
				// console.log(i, `👀 idx`, index)
				const itemIds = await index
				// console.log(i, `👀 iid`, itemIds)
				const items = await Promise.all(itemIds.map((id) => get(itemAtoms, id)))
				// console.log(i, `👀`, items)

				return items
			},
		})

		subscribe(allItemsSelector, ({ newValue, oldValue }) => {
			// console.count(`❗❗❗ subscriber`)
			// console.log(`❗❗❗ subscriber`, {
			// 	newValue,
			// 	oldValue,
			// 	newValueEqualsOldValue: newValue === oldValue,
			// })
			Utils.stdout({ newValue, oldValue })
		})

		expect(getState(indexAtoms, 0)).toBeInstanceOf(Promise)
		expect(getState(itemAtoms, 1)).toBeInstanceOf(Promise)
		expect(getState(itemAtoms, 2)).toBeInstanceOf(Promise)
		expect(getState(itemAtoms, 3)).toBeInstanceOf(Promise)
		expect(getState(allItemsSelector)).toBeInstanceOf(Promise)
		loadIndex[0]()
		await new Promise((resolve) => setImmediate(resolve))
		expect(getState(indexAtoms, 0)).toEqual([1, 2, 3])
		expect(getState(itemAtoms, 1)).toBeInstanceOf(Promise)
		expect(getState(itemAtoms, 2)).toBeInstanceOf(Promise)
		expect(getState(itemAtoms, 3)).toBeInstanceOf(Promise)
		expect(getState(allItemsSelector)).toBeInstanceOf(Promise)
		loadItems[1]()
		await new Promise((resolve) => setImmediate(resolve))
		expect(getState(indexAtoms, 0)).toEqual([1, 2, 3])
		expect(getState(itemAtoms, 1)).toEqual({ data: `1`.repeat(3) })
		expect(getState(itemAtoms, 2)).toBeInstanceOf(Promise)
		expect(getState(itemAtoms, 3)).toBeInstanceOf(Promise)
		expect(getState(allItemsSelector)).toBeInstanceOf(Promise)
		loadItems[2]()
		await new Promise((resolve) => setImmediate(resolve))
		expect(getState(indexAtoms, 0)).toEqual([1, 2, 3])
		expect(getState(itemAtoms, 1)).toEqual({ data: `1`.repeat(3) })
		expect(getState(itemAtoms, 2)).toEqual({ data: `2`.repeat(3) })
		expect(getState(itemAtoms, 3)).toBeInstanceOf(Promise)
		expect(getState(allItemsSelector)).toBeInstanceOf(Promise)
		loadItems[3]()
		await new Promise((resolve) => setImmediate(resolve))
		expect(getState(indexAtoms, 0)).toEqual([1, 2, 3])
		expect(getState(itemAtoms, 1)).toEqual({ data: `1`.repeat(3) })
		expect(getState(itemAtoms, 2)).toEqual({ data: `2`.repeat(3) })
		expect(getState(itemAtoms, 3)).toEqual({ data: `3`.repeat(3) })
		expect(getState(allItemsSelector)).toBeInstanceOf(Promise)
		loadOrgId(0)

		resetState(indexAtoms, 0)
		resetState(itemAtoms, 1)
		expect(getState(indexAtoms, 0)).toBeInstanceOf(Promise)
		expect(getState(itemAtoms, 1)).toBeInstanceOf(Promise)
		expect(getState(itemAtoms, 2)).toEqual({ data: `2`.repeat(3) })
		expect(getState(itemAtoms, 3)).toEqual({ data: `3`.repeat(3) })
		expect(getState(allItemsSelector)).toBeInstanceOf(Promise)

		loadIndex[0]()
		loadItems[1]()
		await new Promise((resolve) => setImmediate(resolve))
		expect(getState(indexAtoms, 0)).toEqual([1, 2, 3])
		expect(getState(itemAtoms, 1)).toEqual({ data: `1`.repeat(3) })
		expect(getState(itemAtoms, 2)).toEqual({ data: `2`.repeat(3) })
		expect(getState(itemAtoms, 3)).toEqual({ data: `3`.repeat(3) })
		expect(getState(allItemsSelector)).toEqual([
			{ data: `1`.repeat(3) },
			{ data: `2`.repeat(3) },
			{ data: `3`.repeat(3) },
		])
	})
})
