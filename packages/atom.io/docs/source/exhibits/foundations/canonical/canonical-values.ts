import type { Canonical } from "atom.io/foundations/canonical"

const primitiveKey = `road-trip` satisfies Canonical
const tupleKey = [`playlist`, `road-trip`, 3] as const satisfies Canonical
const nestedKey = [
	`track`,
	[`playlist`, `road-trip`],
] as const satisfies Canonical

// @ts-expect-error Objects are not Canonical values.
const objectKey = { playlist: `road-trip`, index: 3 } satisfies Canonical
