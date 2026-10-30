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
