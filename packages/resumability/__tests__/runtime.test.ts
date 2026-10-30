import { describe, expect, it, vi } from "vitest"

import { createResumption, resumable as client } from "../src/client.ts"
import { keyOf } from "../src/key.ts"
import { collect, resumable, serialize } from "../src/server.ts"
import type { Key, Payload, ResumableOptions } from "../src/types.ts"
import { encode } from "../src/wire.ts"

const serverValue = <T>(value: T, key: Key = `value`): ResumableOptions<T> => ({
	key,
	server: () => value,
})

describe(`server collection`, () => {
	it(`collects arbitrary values without an atom or renderer`, async () => {
		const task = vi.fn(() => Promise.resolve(`hello`))
		const result = await collect(async () => {
			const a = resumable({ key: `a`, server: task })
			const b = resumable({ key: `a`, server: task })
			expect(a).toBe(b)
			return a
		})
		expect(result).toEqual({
			value: `hello`,
			payload: { version: 1, values: [[`a`, [1, `hello`]]] },
		})
		expect(task).toHaveBeenCalledOnce()
	})
	it(`drains nested tasks discovered after awaits, including unawaited producers`, async () => {
		const { payload } = await collect(() => {
			void resumable({
				key: `outer`,
				server: async () => {
					await Promise.resolve()
					void resumable(serverValue(`inner`, `inner`))
					return `outer`
				},
			})
		})
		expect(payload.values).toHaveLength(2)
		expect(payload.values.map(([key]) => key).sort()).toEqual([`inner`, `outer`])
	})
	it(`isolates concurrent requests and nested scopes`, async () => {
		const [first, second] = await Promise.all(
			[1, 2].map((value) =>
				collect(async () => {
					await Promise.resolve()
					const inner = await collect(() => resumable(serverValue(99)))
					expect(inner.value).toBe(99)
					return resumable(serverValue(value))
				}),
			),
		)
		expect(first.value).toBe(1)
		expect(second.value).toBe(2)
	})
	it(`rejects missing or closed contexts and uses an explicit scope`, async () => {
		expect(() => resumable(serverValue(1))).toThrow(`collect`)
		let late!: () => void
		await collect(() => {
			const resource = new Promise<void>((resolve) => {
				late = resolve
			})
			void resource.then(() => {
				expect(() => resumable(serverValue(1))).toThrow(`closed`)
			})
		})
		late()
		await Promise.resolve()
		const scope = createResumption({ version: 1, values: [[`value`, [1, 8]]] })
		expect(resumable(serverValue(1), scope)).toBe(8)
	})
	it(`propagates synchronous failures, rejections, and callback failures`, async () => {
		await expect(
			collect(() =>
				resumable({
					key: `a`,
					server: () => {
						throw new Error(`sync`)
					},
				}),
			),
		).rejects.toThrow(`sync`)
		await expect(
			collect(() => {
				void resumable({
					key: `a`,
					server: () => Promise.reject(new Error(`async`)),
				})
			}),
		).rejects.toThrow(`async`)
		await expect(
			collect(() => {
				throw new Error(`render`)
			}),
		).rejects.toThrow(`render`)
	})
	it(`aborts hung work and rejects reads and settlement after cancellation`, async () => {
		const controller = new AbortController()
		const pending = Promise.withResolvers<string>()
		let signal!: AbortSignal
		let started!: () => void
		const ready = new Promise<void>((resolve) => {
			started = resolve
		})
		const result = collect(
			() =>
				resumable({
					key: `a`,
					server: (context) => {
						signal = context.signal
						started()
						return pending.promise
					},
				}),
			{ signal: controller.signal },
		)
		await ready
		controller.abort(new Error(`cancelled`))
		await expect(result).rejects.toThrow(`cancelled`)
		expect(signal.aborted).toBe(true)
		pending.resolve(`late`)
		await Promise.resolve()
		await expect(
			collect(() => 1, { signal: controller.signal }),
		).rejects.toThrow(`cancelled`)
		const during = new AbortController()
		await expect(
			collect(
				() => {
					during.abort(new Error(`before-read`))
					return resumable(serverValue(1))
				},
				{ signal: during.signal },
			),
		).rejects.toThrow(`before-read`)
	})
})

describe(`browser resumption`, () => {
	it.each([null, false, 0, ``, undefined, `LOADING`])(
		`consumes %s once and runs a fresh client default on resets`,
		async (value) => {
			const { payload } = await collect(() => resumable(serverValue(value)))
			const scope = createResumption(payload)
			const next = vi.fn(() => value)
			const options = { ...serverValue(value), client: next }
			expect(client(options, scope)).toBe(value)
			expect(next).not.toHaveBeenCalled()
			void client({ ...options }, scope)
			void client({ ...options }, scope)
			expect(next).toHaveBeenCalledTimes(2)
		},
	)
	it(`keeps server-only defaults reusable and isolates browser scopes`, async () => {
		const { payload } = await collect(() => resumable(serverValue({ x: 1 })))
		const first = createResumption(payload)
		const second = createResumption(payload)
		const next = vi.fn(() => ({ x: 2 }))
		const harvested = await client(serverValue({ x: 0 }), first)
		expect(harvested).toEqual({ x: 1 })
		harvested.x = 99
		expect(client(serverValue({ x: 0 }), first)).toEqual({ x: 1 })
		expect(client({ ...serverValue({ x: 0 }), client: next }, first)).toEqual({
			x: 1,
		})
		expect(client({ ...serverValue({ x: 0 }), client: next }, first)).toEqual({
			x: 2,
		})
		expect(client({ ...serverValue({ x: 0 }), client: next }, second)).toEqual({
			x: 1,
		})
	})
	it(`uses client defaults without a sidecar and aborts when disposed`, async () => {
		const scope = createResumption()
		let signal!: AbortSignal
		expect(
			await client(
				{
					key: `a`,
					server: () => 0,
					client: (context) => {
						signal = context.signal
						return Promise.resolve(3)
					},
				},
				scope,
			),
		).toBe(3)
		expect(() => client(serverValue(1), scope)).toThrow(`no server value`)
		expect(() => client(serverValue(1))).toThrow(`createResumption`)
		scope.dispose()
		expect(signal.aborted).toBe(true)
		expect(() => client(serverValue(1), scope)).toThrow()
		scope.dispose()
	})
	it(`decodes the same representation on the server and browser`, async () => {
		const options = {
			key: `date`,
			server: () => new Date(`2026-10-30T00:00:00Z`),
			codec: {
				encode: (date: Date) => date.toISOString(),
				decode: (text: string) => new Date(text),
			},
		}
		const { value, payload } = await collect(() => resumable(options))
		expect(value).toEqual(new Date(`2026-10-30T00:00:00Z`))
		expect(client(options, createResumption(payload))).toEqual(value)
	})
	it(`reads only the direct sidecar and escapes HTML raw-text terminators`, async () => {
		const hostile = `</script><script>alert(1)</script>`
		const { payload } = await collect(() => resumable(serverValue(hostile)))
		const text = serialize(payload)
		expect(text).not.toContain(`<`)
		const element = document.createElement(`section`)
		element.innerHTML = `<section><script data-resumable>invalid</script></section><script type="application/json" data-resumable>${text}</script>`
		expect(client(serverValue(``), createResumption(element))).toBe(hostile)
		expect(() => createResumption(document.createElement(`div`))).toThrow(
			`invalid payload`,
		)
	})
	it.each([
		null,
		{ version: 2, values: [] },
		{ version: 1, values: null },
		{ version: 1, values: [[`a`, [2]]] },
		{ version: 1, values: [[`a`, [0, 1]]] },
		{ version: 1, values: [[`a`, [1]]] },
		{
			version: 1,
			values: [
				[`a`, [0]],
				[`a`, [0]],
			],
		},
	])(`rejects malformed payload %j`, (payload) => {
		expect(() => createResumption(payload as Payload)).toThrow()
	})
})

describe(`wire format`, () => {
	it.each([
		NaN,
		Infinity,
		-0,
		() => {},
		Symbol(`x`),
		new Date(),
		{ a: undefined },
		[undefined],
		new Array(1),
		{ [Symbol(`x`)]: 1 },
	])(`rejects lossy JSON values %s`, (value) => {
		expect(() => encode(value)).toThrow()
	})
	it(`rejects cycles, preserves shared data, and accepts plain null-prototype records`, () => {
		const cycle: unknown[] = []
		cycle.push(cycle)
		expect(() => encode(cycle)).toThrow()
		const shared = { x: 1 }
		expect(encode([shared, shared])).toEqual([1, [{ x: 1 }, { x: 1 }]])
		expect(encode(Object.assign(Object.create(null), { x: 1 }))).toEqual([
			1,
			{ x: 1 },
		])
	})
	it.each([NaN, Infinity, -0, undefined, {}, [undefined]])(
		`rejects invalid key %s`,
		(key) => {
			expect(() => keyOf(key as Key)).toThrow()
		},
	)
	it(`distinguishes canonical key types and nested keys`, () => {
		expect(
			new Set([0, `0`, false, null, [0, [`a`]]].map((key) => keyOf(key as Key)))
				.size,
		).toBe(5)
	})
})

describe(`browser initialization scopes`, () => {
	it(`restores nested scopes after returns and errors, including detached runners`, () => {
		const a = createResumption({ version: 1, values: [[`value`, [1, 1]]] })
		const b = createResumption({ version: 1, values: [[`value`, [1, 2]]] })
		const options = serverValue(0)
		const run = a.run
		expect(
			run(() => {
				expect(client(options)).toBe(1)
				expect(b.run(() => client(options))).toBe(2)
				expect(client(options, b)).toBe(2)
				expect(() =>
					b.run(() => {
						throw new Error(`nested`)
					}),
				).toThrow(`nested`)
				return client(options)
			}),
		).toBe(1)
		expect(() => client(options)).toThrow(`capture`)
		a.dispose()
		expect(() => run(() => 0)).toThrow()
	})
	it(`consumes once, captures producer cancellation, and never keeps an ambient scope across awaits`, async () => {
		const a = createResumption({ version: 1, values: [[`value`, [1, 1]]] })
		let signal!: AbortSignal
		const options = {
			...serverValue(0),
			client: async (context: { signal: AbortSignal }) => {
				signal = context.signal
				await Promise.resolve()
				expect(() => client(serverValue(0))).toThrow(`capture`)
				return 2
			},
		}
		expect(a.run(() => client(options))).toBe(1)
		const pending = a.run(() => client(options))
		expect(() => client(options)).toThrow(`capture`)
		expect(signal.aborted).toBe(false)
		await expect(pending).resolves.toBe(2)
		a.dispose()
		expect(signal.aborted).toBe(true)
	})
})

describe(`application resumption`, () => {
	it(`merges new keys without reseeding consumed defaults or replacing read-only values`, () => {
		const scope = createResumption({
			version: 1,
			values: [
				[`value`, [1, 1]],
				[`readonly`, [1, 2]],
			],
		})
		const options = { ...serverValue(0), client: () => 9 }
		expect(scope.run(() => client(options))).toBe(1)
		expect(scope.run(() => client({ ...serverValue(0), key: `readonly` }))).toBe(
			2,
		)
		scope.add({
			version: 1,
			values: [
				[`value`, [1, 3]],
				[`readonly`, [1, 4]],
				[`new`, [1, 5]],
			],
		})
		expect(scope.run(() => client(options))).toBe(9)
		expect(scope.run(() => client({ ...serverValue(0), key: `readonly` }))).toBe(
			2,
		)
		expect(scope.run(() => client({ ...serverValue(0), key: `new` }))).toBe(5)
	})
	it(`uses fresh client defaults after an app changes, even for a previously unread seed`, () => {
		const scope = createResumption({
			version: 1,
			values: [
				[`value`, [1, 1]],
				[`readonly`, [1, 2]],
			],
		})
		const next = vi.fn(() => 3)
		expect(
			scope.run(
				() => {
					expect(
						scope.run(() => client({ ...serverValue(0), key: `readonly` }), {
							resume: true,
						}),
					).toBe(2)
					expect(() =>
						scope.run(() => {
							throw new Error(`nested`)
						}),
					).toThrow(`nested`)
					return client({ ...serverValue(0), client: next })
				},
				{ resume: false },
			),
		).toBe(3)
		expect(next).toHaveBeenCalledOnce()
		scope.add({ version: 1, values: [[`value`, [1, 10]]] })
		expect(scope.run(() => client({ ...serverValue(0), client: next }))).toBe(3)
		expect(
			scope.run(() => client({ ...serverValue(0), key: `readonly` }), {
				resume: false,
			}),
		).toBe(2)
	})
	it(`validates additions atomically, permits missing-value recovery, and rejects additions after disposal`, () => {
		const scope = createResumption()
		expect(() => scope.run(() => client(serverValue(0)))).toThrow(
			`no server value`,
		)
		expect(() => {
			scope.add({
				version: 1,
				values: [
					[`value`, [1, 1]],
					[`bad`, [2]],
				],
			} as unknown as Payload)
		}).toThrow(`invalid payload entry`)
		expect(() => scope.run(() => client(serverValue(0)))).toThrow(
			`no server value`,
		)
		scope.add({ version: 1, values: [[`value`, [1, 2]]] })
		expect(scope.run(() => client(serverValue(0)))).toBe(2)
		scope.dispose()
		expect(() => {
			scope.add({ version: 1, values: [] })
		}).toThrow()
	})
})
