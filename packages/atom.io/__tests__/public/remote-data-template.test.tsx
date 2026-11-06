/* oxlint-disable typescript/require-await -- Async act callbacks flush promise-driven React updates. */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { setTestLogLevel } from "atom.io/testing"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { App } from "../../../../templates/react-node-backend/src/App.tsx"

const original = { id: 1, text: `Original`, done: 0 }
const updated = { ...original, text: `Updated` }

beforeEach(() => {
	setTestLogLevel(null)
})

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
})

describe(`React/Node template remote-data loader`, () => {
	it(`hydrates accepted lists without detail requests and preserves optimistic mutation flows`, async () => {
		const lists: ReturnType<typeof Promise.withResolvers<Response>>[] = []
		const detailRequests: URL[] = []
		const fetchMock = vi.fn<typeof fetch>((input, options) => {
			const url = new URL(input instanceof Request ? input.url : input)
			if (url.pathname === `/long-load-times`) {
				return Promise.resolve(Response.json(false))
			}
			if (url.pathname !== `/todos`) throw new Error(`Unexpected URL: ${url}`)
			if (options?.method === `POST`) {
				return Promise.resolve(
					Response.json({ id: 2, text: options.body, done: 0 }),
				)
			}
			if (options?.method === `PUT` || options?.method === `DELETE`) {
				return Promise.resolve(Response.json({ success: true }))
			}
			if (url.searchParams.has(`id`)) {
				detailRequests.push(url)
				return Promise.resolve(Response.json({ ...updated, done: 1 }))
			}
			const response = Promise.withResolvers<Response>()
			lists.push(response)
			return response.promise
		})
		vi.stubGlobal(`fetch`, fetchMock)
		const { container } = render(<App />)
		expect(lists).toHaveLength(1)
		await act(async () => {
			lists[0].resolve(Response.json([original]))
		})
		expect(screen.getByText(`Original`)).toBeDefined()
		expect(detailRequests).toEqual([])

		fireEvent.click(screen.getByRole(`button`, { name: `Refresh` }))
		fireEvent.click(screen.getByRole(`button`, { name: `Refresh` }))
		expect(lists).toHaveLength(3)
		await act(async () => {
			lists[2].resolve(Response.json([updated]))
		})
		expect(screen.getByText(`Updated`)).toBeDefined()
		await act(async () => {
			lists[1].resolve(Response.json([original]))
		})
		expect(screen.queryByText(`Original`)).toBe(null)
		expect(screen.getByText(`Updated`)).toBeDefined()
		expect(detailRequests).toEqual([])

		await act(async () => {
			fireEvent.click(container.querySelector(`.todo input[type="checkbox"]`)!)
		})
		expect(detailRequests).toHaveLength(1)
		expect(screen.getByText(`1/1 items done`)).toBeDefined()

		fireEvent.change(screen.getByRole(`textbox`), { target: { value: `Added` } })
		await act(async () => {
			fireEvent.click(screen.getByRole(`button`, { name: `Add Todo` }))
		})
		expect(screen.getByText(`Added`)).toBeDefined()
		expect(screen.getByText(`1/2 items done`)).toBeDefined()
		await act(async () => {
			fireEvent.click(
				screen
					.getByText(`Added`)
					.closest(`.todo`)!
					.querySelector(`button.delete`)!,
			)
		})
		expect(screen.queryByText(`Added`)).toBe(null)
		expect(screen.getByText(`1/1 items done`)).toBeDefined()
		expect(lists).toHaveLength(3)
		expect(detailRequests).toHaveLength(1)
	})
})
