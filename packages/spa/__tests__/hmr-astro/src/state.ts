import { atom, Silo } from "atom.io"

export const countAtom = atom<number>({ key: `count`, default: 0 })
export function createStore(props: { initial: number }): Silo[`store`] {
	const silo = new Silo({
		name: `hot-island`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	silo.install([countAtom])
	silo.setState(countAtom, props.initial)
	return silo.store
}
