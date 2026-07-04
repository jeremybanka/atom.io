import { Silo } from "atom.io"
import { hasImplicitStoreBeenCreated } from "atom.io/testing"

hasImplicitStoreBeenCreated() // -> false

new Silo({
	name: `isolated`,
	lifespan: `ephemeral`,
	isProduction: false,
})

hasImplicitStoreBeenCreated() // -> false
