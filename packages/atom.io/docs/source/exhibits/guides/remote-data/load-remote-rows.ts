import { atom, atomFamily, setState, type Loadable } from "atom.io"

type Row = {
	id: string
	title: string
	status: "open" | "closed"
	updatedAt: string
}

type RowKey = `row::${string}`

export const rowKeysAtom = atom<Loadable<readonly RowKey[]>, Error>({
	key: "rowKeys",
	default: async () => {
		const rows = await client.rows.list()
		return loadRows(rows)
	},
	catch: [Error],
})

export const rowAtoms = atomFamily<Loadable<Row>, RowKey, Error>({
	key: "row",
	default: async (key) => {
		const id = key.slice("row::".length)
		const row = await client.rows.get({ id })
		loadRow(row)
		return row
	},
	catch: [Error],
})

function rowKey(id: string): RowKey {
	return `row::${id}`
}

function loadRows(rows: readonly Row[]): readonly RowKey[] {
	return rows.map(loadRow)
}

function loadRow(row: Row): RowKey {
	const key = rowKey(row.id)
	setState(rowAtoms, key, row)
	return key
}
