import {
	atom,
	atomFamily,
	getState,
	type Loadable,
	selectorFamily,
	setState,
} from "atom.io"

import { client, type Row, type RowListView } from "./client.ts"

type RowKey = `row::${string}`

type RowIndexView = readonly [
	pageNumber: RowListView[`offset`],
	pageSize: RowListView[`limit`],
	search: RowListView[`search`],
	status: RowListView[`status`],
]

const DEFAULT_ROW_INDEX_VIEW: RowIndexView = [0, 25, ``, null]

export const acquiredRowKeysAtom = atom<readonly RowKey[]>({
	key: `acquiredRowKeys`,
	default: [],
})

export const rowAtoms = atomFamily<Loadable<Row>, RowKey, Error>({
	key: `row`,
	default: async (key) => {
		const id = key.slice(`row::`.length)
		const row = await client.rows.get({ id })
		loadRow(row)
		return row
	},
	catch: [Error],
})

export const rowIndexViewAtom = atom<RowIndexView>({
	key: `rowIndexView`,
	default: () => {
		// DOCS REVIEW: This default kicks off a load by reading the family member.
		// Should the guide call this out as an intentional hydration trigger?
		void getState(rowKeysForViewAtoms, DEFAULT_ROW_INDEX_VIEW)
		return DEFAULT_ROW_INDEX_VIEW
	},
	effects: [
		({ onSet }) => {
			onSet(({ newValue }) => {
				void getState(rowKeysForViewAtoms, newValue)
			})
		},
	],
})

export const rowKeysForViewAtoms = atomFamily<
	Loadable<readonly RowKey[]>,
	RowIndexView,
	Error
>({
	key: `rowKeysForView`,
	// DOCS REVIEW: Tuple keys are compact, but agents/readers may wonder how
	// atom.io compares family keys. Should the surrounding docs explain why this
	// tuple is stable and what would happen with an object view key?
	default: async ([pageNumber, pageSize, search, status]) => {
		const result = await client.rows.listPage({
			offset: pageNumber * pageSize,
			limit: pageSize,
			search,
			status,
		})
		return loadRows(result.rows)
	},
	catch: [Error],
})

export const visibleRowKeysSelectors = selectorFamily<
	Loadable<readonly RowKey[]>,
	RowIndexView,
	Error
>({
	key: `visibleRowKeys`,
	get:
		(view) =>
		({ get }) => {
			const [pageNumber, pageSize, search, status] = view
			const normalizedSearch = search.trim().toLowerCase()

			const deriveVisibleKeys = () =>
				get(acquiredRowKeysAtom)
					.filter((key) => {
						const row = get(rowAtoms, key)
						if (row instanceof Promise || row instanceof Error) return false
						if (status !== null && row.status !== status) return false
						return (
							normalizedSearch === `` ||
							row.title.toLowerCase().includes(normalizedSearch)
						)
					})
					.toSorted((a, b) => {
						const rowA = get(rowAtoms, a)
						const rowB = get(rowAtoms, b)
						if (
							rowA instanceof Promise ||
							rowB instanceof Promise ||
							rowA instanceof Error ||
							rowB instanceof Error
						) {
							return 0
						}
						return rowB.updatedAt.localeCompare(rowA.updatedAt)
					})
					.slice(pageNumber * pageSize, (pageNumber + 1) * pageSize)

			const keysForView = get(rowKeysForViewAtoms, view)
			return keysForView instanceof Promise
				? keysForView.then(deriveVisibleKeys)
				: deriveVisibleKeys()
		},
	catch: [Error],
})

function rowKey(id: string): RowKey {
	return `row::${id}`
}

function loadRows(rows: readonly Row[]): readonly RowKey[] {
	const keys = rows.map(loadRow)
	setState(acquiredRowKeysAtom, (previousKeys) => {
		const seen = new Set(previousKeys)
		const merged = [...previousKeys]
		for (const key of keys) {
			if (seen.has(key)) continue
			seen.add(key)
			merged.push(key)
		}
		return merged
	})
	return keys
}

function loadRow(row: Row): RowKey {
	const key = rowKey(row.id)
	setState(rowAtoms, key, row)
	return key
}
