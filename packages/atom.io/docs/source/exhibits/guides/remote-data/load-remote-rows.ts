import {
	atom,
	atomFamily,
	type Loadable,
	runTransaction,
	selector,
	transaction,
} from "atom.io"

import { client, type Row } from "./client.ts"

type RowKey = `row::${string}`

export const rowAtoms = atomFamily<Loadable<Row>, RowKey, Error>({
	key: `row`,
	default: (key) => client.rows.get({ id: key.slice(`row::`.length) }),
	catch: [Error],
})

const loadRowsTransaction = transaction<(rows: readonly Row[]) => void>({
	key: `loadRows`,
	do: ({ set }, rows) => {
		for (const row of rows) set(rowAtoms, rowKey(row.id), row)
	},
})

export const rowListAtom = atom<Loadable<readonly Row[]>, Error>({
	key: `rowList`,
	default: () => client.rows.list(),
	catch: [Error],
	effects: [
		({ onSet }) => {
			onSet(({ newValue }) => {
				if (newValue instanceof Promise || newValue instanceof Error) return
				// Only accepted responses hydrate shared state. Keep this synchronous.
				runTransaction(loadRowsTransaction)(newValue)
			})
		},
	],
})

export const rowKeysSelector = selector<Loadable<readonly RowKey[]>, Error>({
	key: `rowKeys`,
	get: async ({ get }) => {
		const rows = await get(rowListAtom)
		if (rows instanceof Error) throw rows
		return rows.map((row) => rowKey(row.id))
	},
	catch: [Error],
})

function rowKey(id: string): RowKey {
	return `row::${id}`
}
