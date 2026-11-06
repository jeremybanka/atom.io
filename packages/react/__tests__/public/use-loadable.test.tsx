import { StoreProvider, useLoadable } from "@atom.io/react"
import { act, render, renderHook } from "@testing-library/react"
import type { Loadable } from "atom.io"
import {
	atomFamily,
	getState,
	resetState,
	selectorFamily,
	setState,
	Silo,
} from "atom.io"
import { setTestLogLevel, takeSnapshot } from "atom.io/testing"

const { restore } = takeSnapshot()

beforeEach(() => {
	restore()
	setTestLogLevel(null)
})

type PageKey = readonly [projectId: string, page: number]

function createPages(kind: `atom` | `selector`, name = `pages`) {
	const loads = new Map<
		number,
		ReturnType<typeof Promise.withResolvers<string>>
	>()
	const pageOptions = {
		key: name,
		default: ([, page]: PageKey) => {
			const load = Promise.withResolvers<string>()
			loads.set(page, load)
			return load.promise
		},
		catch: [Error],
	}
	const pageAtoms = atomFamily<Loadable<string>, PageKey, Error>(pageOptions)
	const family =
		kind === `atom`
			? pageAtoms
			: selectorFamily<Loadable<string>, PageKey, Error>({
					key: `${name}Selectors`,
					get:
						(key) =>
						({ get }) => {
							const value = get(pageAtoms, key)
							if (value instanceof Error) throw value
							return value
						},
					catch: [Error],
				})
	const resolve = async (page: number, value: string) => {
		await act(async () => {
			const load = loads.get(page)!
			load.resolve(value)
			await load.promise
		})
	}
	return { atoms: pageAtoms, family, loads, resolve }
}

const cases = [
	{ kind: `atom`, fallback: undefined },
	{ kind: `atom`, fallback: `fallback` },
	{ kind: `selector`, fallback: undefined },
	{ kind: `selector`, fallback: `fallback` },
] as const

describe(`useLoadable member retention`, () => {
	test.each(cases)(
		`does not show A while a new B loads ($kind, fallback: $fallback)`,
		async ({ kind, fallback }) => {
			const { family, resolve } = createPages(kind)
			const { result, rerender } = renderHook(
				({ page }) =>
					fallback === undefined
						? useLoadable(family, [`project`, page])
						: useLoadable(family, [`project`, page], fallback),
				{ initialProps: { page: 1 } },
			)
			await resolve(1, `A`)
			expect(result.current).toEqual({ loading: false, value: `A` })

			rerender({ page: 2 })
			expect(result.current).toEqual(
				fallback === undefined ? `LOADING` : { loading: true, value: fallback },
			)
			await resolve(2, `B`)
			expect(result.current).toEqual({ loading: false, value: `B` })

			rerender({ page: 1 })
			expect(result.current).toEqual({ loading: false, value: `A` })
		},
	)

	test.each(cases)(
		`retains A after B when A is invalidated ($kind, fallback: $fallback)`,
		async ({ kind, fallback }) => {
			const { atoms, family, resolve } = createPages(kind)
			const { result, rerender } = renderHook(
				({ page }) =>
					fallback === undefined
						? useLoadable(family, [`project`, page])
						: useLoadable(family, [`project`, page], fallback),
				{ initialProps: { page: 1 } },
			)
			await resolve(1, `A`)
			rerender({ page: 2 })
			await resolve(2, `B`)

			act(() => {
				resetState(atoms, [`project`, 1])
			})
			expect(getState(atoms, [`project`, 1])).toBeInstanceOf(Promise)
			rerender({ page: 1 })
			expect(result.current).toEqual({ loading: true, value: `A` })
			await resolve(1, `A refreshed`)
			expect(result.current).toEqual({ loading: false, value: `A refreshed` })

			act(() => {
				resetState(atoms, [`project`, 1])
			})
			expect(result.current).toEqual({ loading: true, value: `A refreshed` })
			await resolve(1, `A refreshed again`)
			expect(result.current).toEqual({
				loading: false,
				value: `A refreshed again`,
			})
		},
	)

	test.each(cases)(
		`scopes caught errors and retries to the member ($kind, fallback: $fallback)`,
		async ({ kind, fallback }) => {
			const { atoms, family, loads, resolve } = createPages(kind)
			const { result, rerender } = renderHook(
				({ page }) =>
					fallback === undefined
						? useLoadable(family, [`project`, page])
						: useLoadable(family, [`project`, page], fallback),
				{ initialProps: { page: 1 } },
			)
			const error = new Error(`A failed`)
			await act(async () => {
				const load = loads.get(1)!
				load.reject(error)
				await expect(load.promise).rejects.toBe(error)
			})
			expect(result.current).toEqual(
				fallback === undefined
					? { loading: false, value: error }
					: { loading: false, value: fallback, error },
			)

			rerender({ page: 2 })
			expect(result.current).toEqual(
				fallback === undefined ? `LOADING` : { loading: true, value: fallback },
			)
			await resolve(2, `B`)
			act(() => {
				resetState(atoms, [`project`, 1])
			})
			rerender({ page: 1 })
			expect(result.current).toEqual(
				fallback === undefined
					? { loading: true, value: error }
					: { loading: true, value: fallback, error },
			)
			await resolve(1, `A recovered`)
			expect(result.current).toEqual({ loading: false, value: `A recovered` })
		},
	)

	test.each([`atom`, `selector`] as const)(
		`scopes retention to the family token for %s families`,
		async (kind) => {
			const first = createPages(kind)
			const second = createPages(kind, `otherPages`)
			const { result, rerender } = renderHook(
				({ family }) => useLoadable(family, [`project`, 1], `fallback`),
				{ initialProps: { family: first.family } },
			)
			await first.resolve(1, `first family`)

			rerender({ family: second.family })
			expect(result.current).toEqual({ loading: true, value: `fallback` })
			await second.resolve(1, `second family`)
			act(() => {
				resetState(first.atoms, [`project`, 1])
			})
			rerender({ family: first.family })
			expect(result.current).toEqual({ loading: true, value: `first family` })
			await first.resolve(1, `first family refreshed`)
		},
	)

	test(`uses the current fallback until settled, including null, and retains undefined data`, async () => {
		const load = Promise.withResolvers<string | null | undefined>()
		const nullablePageAtoms = atomFamily<
			Loadable<string | null | undefined>,
			number
		>({
			key: `nullablePage`,
			default: () => load.promise,
		})
		const { result, rerender } = renderHook(
			({ page, fallback }) => useLoadable(nullablePageAtoms, page, fallback),
			{ initialProps: { page: 1, fallback: null as string | null } },
		)
		expect(result.current).toEqual({ loading: true, value: null })
		rerender({ page: 1, fallback: `fallback` })
		expect(result.current).toEqual({ loading: true, value: `fallback` })
		await act(async () => {
			load.resolve(undefined)
			await load.promise
		})
		expect(result.current).toEqual({ loading: false, value: undefined })

		rerender({ page: 2, fallback: `fallback` })
		act(() => {
			setState(
				nullablePageAtoms,
				1,
				new Promise<string | null | undefined>(() => {}),
			)
		})
		rerender({ page: 1, fallback: `new fallback` })
		expect(result.current).toEqual({ loading: true, value: undefined })
	})

	test(`scopes retention to the provider store`, async () => {
		const { atoms, resolve } = createPages(`atom`)
		const other = new Silo({
			name: `other`,
			lifespan: `ephemeral`,
			isProduction: false,
		})
		other.install([atoms])
		let current: unknown
		function Page() {
			current = useLoadable(atoms, [`project`, 1], `fallback`)
			return null
		}
		const view = (store?: typeof other.store) => (
			<StoreProvider {...(store ? { store } : {})}>
				<Page />
			</StoreProvider>
		)
		const { rerender } = render(view())
		await resolve(1, `original store`)
		expect(current).toEqual({ loading: false, value: `original store` })

		rerender(view(other.store))
		expect(current).toEqual({ loading: true, value: `fallback` })
		await resolve(1, `other store`)
		expect(current).toEqual({ loading: false, value: `other store` })
		rerender(view())
		expect(current).toEqual({ loading: false, value: `original store` })
	})
})
