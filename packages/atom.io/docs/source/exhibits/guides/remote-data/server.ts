import { os } from "@orpc/server"
import { type } from "arktype"

export type Profile = {
	id: string
	displayName: string
	plan: "free" | "pro"
}

export type RowStatus = "open" | "closed"

export type Row = {
	id: string
	title: string
	status: RowStatus
	updatedAt: string
}

export type RowListView = {
	offset: number
	limit: number
	search: string
	status: RowStatus | null
}

const profileData: Profile | undefined = {
	id: "user_01",
	displayName: "Ada Lovelace",
	plan: "pro",
}

const rowData: readonly Row[] = [
	{
		id: "row_01",
		title: "Repair optimistic row hydration",
		status: "open",
		updatedAt: "2026-06-09T18:00:00.000Z",
	},
	{
		id: "row_02",
		title: "Ship remote-data docs",
		status: "closed",
		updatedAt: "2026-06-08T15:30:00.000Z",
	},
	{
		id: "row_03",
		title: "Add ORPC-backed example",
		status: "open",
		updatedAt: "2026-06-07T12:45:00.000Z",
	},
]

const rowQuerySchema = type({
	offset: "number",
	limit: "number",
	search: "string",
	status: "'open' | 'closed' | null",
})

export const server = {
	users: {
		profile: os
			.errors({
				NOT_FOUND: {
					data: type({ userId: "string" }),
				},
			})
			.handler(({ errors }) => {
				if (profileData === undefined) {
					throw errors.NOT_FOUND({
						data: { userId: "me" },
					})
				}
				return profileData
			}),
	},
	rows: {
		list: os.handler(() => {
			return rowData
		}),
		listPage: os.input(rowQuerySchema).handler(({ input }) => {
			const search = input.search.trim().toLowerCase()
			const filteredRows = rowData.filter((row) => {
				if (input.status !== null && row.status !== input.status) return false
				return search === "" || row.title.toLowerCase().includes(search)
			})
			return {
				rows: filteredRows.slice(input.offset, input.offset + input.limit),
				total: filteredRows.length,
			}
		}),
		get: os
			.input(type({ id: "string" }))
			.errors({
				NOT_FOUND: {
					data: type({ id: "string" }),
				},
			})
			.handler(({ errors, input }) => {
				const row = rowData.find((candidate) => candidate.id === input.id)
				if (row === undefined) {
					throw errors.NOT_FOUND({
						data: { id: input.id },
					})
				}
				return row
			}),
	},
}
