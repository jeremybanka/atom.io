import { getState } from "atom.io"
import { setTestLogLevel, takeSnapshot } from "atom.io/testing"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { Row } from "../source/exhibits/guides/remote-data/client.ts"
import {
	rowAtoms,
	rowKeysSelector,
} from "../source/exhibits/guides/remote-data/load-remote-rows.ts"
import { refreshRows } from "../source/exhibits/guides/remote-data/refresh-remote-rows.ts"
import { updateRowStatus } from "../source/exhibits/guides/remote-data/reset-after-mutation.ts"

const api = vi.hoisted(() => ({
	list: vi.fn(),
	get: vi.fn(),
	updateStatus: vi.fn(),
}))
vi.mock(`../source/exhibits/guides/remote-data/client.ts`, () => ({
	client: { rows: api },
}))

const original: Row = {
	id: `row_01`,
	title: `Original`,
	status: `open`,
	updatedAt: `2026-06-09T18:00:00.000Z`,
	revision: 1,
}
const updated: Row = { ...original, title: `Updated`, revision: 2 }
const { restore } = takeSnapshot()

beforeEach(() => {
	restore()
	setTestLogLevel(null)
	vi.resetAllMocks()
})

describe(`remote-data loader exhibit`, () => {
	it(`hydrates initial and refreshed lists before key consumers read entities without detail requests`, async () => {
		api.list.mockResolvedValueOnce([original]).mockResolvedValueOnce([updated])
		const initialKeys = await getState(rowKeysSelector)
		if (initialKeys instanceof Error) throw initialKeys
		expect(initialKeys).toEqual([`row::row_01`])
		expect(initialKeys.map((key) => getState(rowAtoms, key))).toEqual([original])
		refreshRows()
		const refreshedKeys = await getState(rowKeysSelector)
		if (refreshedKeys instanceof Error) throw refreshedKeys
		expect(refreshedKeys).toEqual([`row::row_01`])
		expect(refreshedKeys.map((key) => getState(rowAtoms, key))).toEqual([
			updated,
		])
		expect(api.list).toHaveBeenCalledTimes(2)
		expect(api.get).not.toHaveBeenCalled()
	})

	it.each([`before`, `after`] as const)(
		`ignores superseded hydration resolving %s the accepted refresh`,
		async (order) => {
			api.list.mockResolvedValueOnce([original])
			await getState(rowKeysSelector)
			const slow = Promise.withResolvers<Row[]>()
			const fast = Promise.withResolvers<Row[]>()
			api.list
				.mockReturnValueOnce(slow.promise)
				.mockReturnValueOnce(fast.promise)
			refreshRows()
			refreshRows()
			if (order === `before`) {
				slow.resolve([{ ...original, title: `Obsolete` }])
				await slow.promise
				expect(getState(rowAtoms, `row::row_01`)).toEqual(original)
			}
			fast.resolve([updated])
			await getState(rowKeysSelector)
			if (order === `after`) {
				slow.resolve([original])
				await slow.promise
			}
			expect(getState(rowAtoms, `row::row_01`)).toEqual(updated)
			expect(api.list).toHaveBeenCalledTimes(3)
			expect(api.get).not.toHaveBeenCalled()
		},
	)

	it(`resyncs a mutation by intentionally fetching only the affected row`, async () => {
		api.list.mockResolvedValue([original])
		await getState(rowKeysSelector)
		const saved: Row = { ...updated, status: `closed` }
		api.updateStatus.mockResolvedValue({ success: true })
		api.get.mockResolvedValue(saved)
		await updateRowStatus(original.id, `closed`)
		expect(await getState(rowAtoms, `row::row_01`)).toEqual(saved)
		expect(api.get).toHaveBeenCalledExactlyOnceWith({ id: original.id })
		expect(api.list).toHaveBeenCalledTimes(1)
	})
})
