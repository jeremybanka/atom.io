import {
	createJoin,
	editRelationsInStore,
	type RootStore,
	Store,
} from "atom.io/internal"
import * as v from "vitest"

const OWNER = `owner` as const
const RELATION_COUNTS = [32, 128, 512, 2_048] as const

type Related = `related:${number}`

function prepareJoin(relationCount: number) {
	const store = new Store({
		name: `join-replacement-benchmark:${relationCount}`,
		lifespan: `ephemeral`,
		isProduction: true,
	}) as RootStore
	store.loggers[0].logLevel = null

	const relatedKeys = Array.from(
		{ length: relationCount },
		(_, index): Related => `related:${index}`,
	)
	const token = createJoin(store, {
		key: `join-replacement-benchmark:${relationCount}`,
		between: [`owner`, `related`],
		cardinality: `n:n`,
		isAType: (input): input is typeof OWNER => input === OWNER,
		isBType: (input): input is Related => input.startsWith(`related:`),
	})

	editRelationsInStore(store, token, (relations) => {
		relations.replaceRelations(OWNER, relatedKeys, { reckless: true })
	})

	return { relatedKeys, store, token }
}

v.describe(`safe join relation replacement`, () => {
	for (const relationCount of RELATION_COUNTS) {
		const { relatedKeys, store, token } = prepareJoin(relationCount)

		v.bench(
			`${relationCount} unchanged relations`,
			() => {
				editRelationsInStore(store, token, (relations) => {
					relations.replaceRelations(OWNER, relatedKeys)
				})
			},
			{ time: 750, warmupTime: 250 },
		)
	}
})
