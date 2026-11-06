import { getState, resetState } from "atom.io"
import { setTestLogLevel, takeSnapshot } from "atom.io/testing"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { Row } from "../source/exhibits/guides/remote-data/client.ts"
import {
	acquiredRowKeysAtom,
	rowAtoms,
	rowIndexViewAtom,
	rowKeysForViewSelectors,
	rowPageAtoms,
	rowResponseAtoms,
	visibleRowKeysSelectors,
} from "../source/exhibits/guides/remote-data/loadable-local-index.ts"

const api = vi.hoisted(() => ({ listPage: vi.fn(), get: vi.fn() }))
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
const view = [0, 25, ``, null] as const
const recent = [0, 25, `updated`, null] as const
const { restore } = takeSnapshot()

beforeEach(() => {
	restore()
	setTestLogLevel(null)
	vi.resetAllMocks()
})

describe(`remote-data local-index exhibit`, () => {
	it(`derives keys from hydrated local records with one page request and no detail requests`, async () => {
		api.listPage.mockResolvedValue({ rows: [original], total: 1 })
		expect(await getState(visibleRowKeysSelectors, view)).toEqual([
			`row::row_01`,
		])
		expect(getState(rowAtoms, `row::row_01`)).toEqual(original)
		expect(getState(acquiredRowKeysAtom)).toEqual([`row::row_01`])
		expect(getState(rowIndexViewAtom)).toEqual(view)
		expect(await getState(rowKeysForViewSelectors, view)).toEqual([
			`row::row_01`,
		])
		expect(api.listPage).toHaveBeenCalledTimes(1)
		expect(api.get).not.toHaveBeenCalled()
	})

	it(`reconciles shared rows across accepted pages and individual-record responses`, async () => {
		const older = Promise.withResolvers<{ rows: Row[]; total: number }>()
		api.listPage
			.mockResolvedValueOnce({ rows: [updated], total: 1 })
			.mockReturnValueOnce(older.promise)
		await getState(rowKeysForViewSelectors, recent)
		const olderKeys = getState(rowKeysForViewSelectors, view)
		older.resolve({ rows: [original], total: 1 })
		expect(await olderKeys).toEqual([`row::row_01`])
		expect(getState(rowPageAtoms, view)).toEqual({ rows: [original], total: 1 })
		expect(getState(rowAtoms, `row::row_01`)).toEqual(updated)
		expect(api.get).not.toHaveBeenCalled()

		const saved: Row = { ...updated, title: `Saved`, revision: 3 }
		api.get.mockResolvedValue(saved)
		await getState(rowResponseAtoms, `row::row_01`)
		expect(getState(rowAtoms, `row::row_01`)).toEqual(saved)
		api.listPage.mockResolvedValueOnce({ rows: [updated], total: 1 })
		resetState(rowPageAtoms, recent)
		await getState(rowKeysForViewSelectors, recent)
		expect(getState(rowAtoms, `row::row_01`)).toEqual(saved)
		expect(api.get).toHaveBeenCalledExactlyOnceWith({ id: original.id })
	})

	it(`rejects superseded pages before their record revisions are considered`, async () => {
		const obsolete = Promise.withResolvers<{ rows: Row[]; total: number }>()
		api.listPage
			.mockReturnValueOnce(obsolete.promise)
			.mockResolvedValueOnce({ rows: [updated], total: 1 })
		void getState(rowKeysForViewSelectors, view)
		resetState(rowPageAtoms, view)
		await getState(rowKeysForViewSelectors, view)
		obsolete.resolve({ rows: [{ ...original, revision: 99 }], total: 1 })
		await obsolete.promise
		expect(getState(rowAtoms, `row::row_01`)).toEqual(updated)
		expect(api.listPage).toHaveBeenCalledTimes(2)
		expect(api.get).not.toHaveBeenCalled()
	})
})
