import {
	atom,
	atomFamily,
	getState,
	type Loadable,
	runTransaction,
	selectorFamily,
	transaction,
} from "atom.io"

import { client, type Row, type RowListView } from "./client.ts"

type RowKey = `row::${string}`
type RowPage = Awaited<ReturnType<typeof client.rows.listPage>>

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

// Local entity reads never fetch. The revision stays beside its server snapshot.
export const rowAtoms = atomFamily<Row | null, RowKey>({
	key: `row`,
	default: null,
})

const loadRowsTransaction = transaction<(rows: readonly Row[]) => void>({
	key: `loadRows`,
	do: ({ get, set }, rows) => {
		const acquired = new Set(get(acquiredRowKeysAtom))
		for (const row of rows) {
			const key = rowKey(row.id)
			const current = get(rowAtoms, key)
			// Different query keys can both be current. The server revision orders
			// their shared records independently of request or response order.
			if (current === null || row.revision > current.revision) {
				set(rowAtoms, key, row)
			}
			acquired.add(key)
		}
		set(acquiredRowKeysAtom, [...acquired])
	},
})

export const rowResponseAtoms = atomFamily<Loadable<Row>, RowKey, Error>({
	key: `rowResponse`,
	default: (key) => client.rows.get({ id: key.slice(`row::`.length) }),
	catch: [Error],
	effects: () => [
		({ onSet }) => {
			onSet(({ newValue }) => {
				if (newValue instanceof Promise || newValue instanceof Error) return
				runTransaction(loadRowsTransaction)([newValue])
			})
		},
	],
})

export const rowPageAtoms = atomFamily<Loadable<RowPage>, RowIndexView, Error>({
	key: `rowPage`,
	default: ([pageNumber, pageSize, search, status]) =>
		client.rows.listPage({
			offset: pageNumber * pageSize,
			limit: pageSize,
			search,
			status,
		}),
	catch: [Error],
	effects: () => [
		({ onSet }) => {
			onSet(({ newValue }) => {
				if (newValue instanceof Promise || newValue instanceof Error) return
				runTransaction(loadRowsTransaction)(newValue.rows)
			})
		},
	],
})

export const rowIndexViewAtom = atom<RowIndexView>({
	key: `rowIndexView`,
	default: () => {
		void getState(rowPageAtoms, DEFAULT_ROW_INDEX_VIEW)
		return DEFAULT_ROW_INDEX_VIEW
	},
	effects: [
		({ onSet }) => {
			onSet(({ newValue }) => {
				void getState(rowPageAtoms, newValue)
			})
		},
	],
})

export const rowKeysForViewSelectors = selectorFamily<
	Loadable<readonly RowKey[]>,
	RowIndexView,
	Error
>({
	key: `rowKeysForView`,
	get:
		(view) =>
		async ({ get }) => {
			const page = await get(rowPageAtoms, view)
			if (page instanceof Error) throw page
			return page.rows.map((row) => rowKey(row.id))
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
		async ({ get }) => {
			const keysForView = await get(rowKeysForViewSelectors, view)
			if (keysForView instanceof Error) throw keysForView
			const [pageNumber, pageSize, search, status] = view
			const normalizedSearch = search.trim().toLowerCase()

			return get(acquiredRowKeysAtom)
				.filter((key) => {
					const row = get(rowAtoms, key)
					if (row === null) return false
					if (status !== null && row.status !== status) return false
					return (
						normalizedSearch === `` ||
						row.title.toLowerCase().includes(normalizedSearch)
					)
				})
				.toSorted((a, b) => {
					const rowA = get(rowAtoms, a)
					const rowB = get(rowAtoms, b)
					if (rowA === null || rowB === null) return 0
					return rowB.updatedAt.localeCompare(rowA.updatedAt)
				})
				.slice(pageNumber * pageSize, (pageNumber + 1) * pageSize)
		},
	catch: [Error],
})

function rowKey(id: string): RowKey {
	return `row::${id}`
}
