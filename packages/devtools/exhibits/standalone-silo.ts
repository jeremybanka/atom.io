import { Silo } from "atom.io"

const silo = new Silo({
	name: `Example store`,
	lifespan: `ephemeral`,
	isProduction: false,
})
const counterAtom = silo.atom<number>({ key: `counter`, default: 0 })
silo.setState(counterAtom, 1)

export default silo
