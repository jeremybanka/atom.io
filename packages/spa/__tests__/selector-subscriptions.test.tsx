import { Silo } from "atom.io"
import { afterEach, expect, it } from "vitest"

import type { SpaRoot } from "../src/index.ts"
import { render, useGetter } from "../src/index.ts"

const roots: SpaRoot[] = []
afterEach(() => {
	for (const root of roots.splice(0)) root.dispose()
	document.body.replaceChildren()
})

function fixture() {
	const silo = new Silo({
		name: `selector-subscriptions`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const countAtom = silo.atom<number>({ key: `count`, default: 0 })
	const mount = (setup: Parameters<typeof render>[0]) => {
		const host = document.createElement(`div`)
		document.body.append(host)
		const root = render(setup, host, { store: silo.store })
		roots.push(root)
		return { root, host }
	}
	return { silo, countAtom, mount }
}

it(`keeps a shared selector reactive when another root unmounts`, () => {
	const { silo, countAtom, mount } = fixture()
	const doubledSelector = silo.selector<number>({
		key: `doubled`,
		get: ({ get }) => get(countAtom) * 2,
	})
	function Counter() {
		const getDoubled = useGetter(doubledSelector)
		return <span>{getDoubled()}</span>
	}
	const first = mount(() => <Counter />)
	const second = mount(() => <Counter />)
	first.root.dispose()
	silo.setState(countAtom, 2)
	second.root.flush()
	expect(second.host.textContent).toBe(`4`)
	second.root.dispose()
	expect(silo.store.atoms.get(countAtom.key)!.subject.subscribers.size).toBe(0)
})

it(`updates projections of held selectors without replacing their object`, () => {
	const { silo, countAtom, mount } = fixture()
	const constant = { doubled: 0 }
	const doubledSelector = silo.selector<{ doubled: number }>({
		key: `doubled`,
		const: constant,
		get: ({ get }, value) => {
			value.doubled = get(countAtom) * 2
		},
	})
	function Counter() {
		const getDoubled = useGetter(doubledSelector)
		return (
			<span title={String(getDoubled().doubled)}>{getDoubled().doubled}</span>
		)
	}
	const { root, host } = mount(() => <Counter />)
	silo.setState(countAtom, 2)
	root.flush()
	expect(host.textContent).toBe(`4`)
	expect(host.querySelector(`span`)!.title).toBe(`4`)
	expect(silo.getState(doubledSelector)).toBe(constant)
	root.dispose()
	expect(silo.store.atoms.get(countAtom.key)!.subject.subscribers.size).toBe(0)
})
