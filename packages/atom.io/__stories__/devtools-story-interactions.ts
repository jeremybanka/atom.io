import type { StoryObj } from "@storybook/react-vite"
import { expect, waitFor, within } from "storybook/test"

type Play = NonNullable<StoryObj[`play`]>
type Context = Parameters<Play>[0]

function orderTools({ canvas, canvasElement, userEvent }: Context) {
	const drawer = canvasElement.querySelector<HTMLDetailsElement>(
		`.order-fulfillment-controls`,
	)!
	const controls = async (open: boolean) => {
		if (drawer.open !== open)
			await userEvent.click(drawer.querySelector(`summary`)!)
	}
	const action = async (name: string) => {
		await controls(true)
		await userEvent.click(canvas.getByRole(`button`, { name }))
	}
	const summary = () => canvas.getByTestId(`order-summary`)
	const ready = async () => {
		await waitFor(() =>
			expect(canvas.getByTestId(`ecology-view`)).toHaveAttribute(
				`data-ready`,
				`true`,
			),
		)
	}
	const ecology = async () => {
		await controls(false)
		const tab = canvas.getByRole(`tab`, { name: `ecology` })
		if (tab.getAttribute(`aria-selected`) !== `true`) await userEvent.click(tab)
		await ready()
	}
	const project = async (run: () => Promise<void>) => {
		await controls(false)
		const graph = canvas.getByTestId(`ecology-view`)
		const previous = graph.dataset[`jobs`]
		await run()
		await waitFor(() => expect(graph.dataset[`jobs`]).not.toBe(previous))
		await ready()
	}
	const refresh = () =>
		project(() =>
			userEvent.click(canvas.getByRole(`button`, { name: `Refresh` })),
		)
	const choose = async (key: string, family = false) => {
		await controls(false)
		const input = canvas.getByRole(`textbox`, { name: `Search ecology` })
		await project(async () => {
			await userEvent.clear(input)
			await userEvent.type(input, key)
		})
		const graph = canvas.getByTestId(`ecology-view`)
		const details = graph.querySelector(`details`)!
		if (!details.open) await userEvent.click(details.querySelector(`summary`)!)
		const id = `${family ? `family` : `state`}:${key}`
		const button = graph.querySelector<HTMLElement>(
			`.ecology-list button[data-graph-id=${JSON.stringify(id)}]`,
		)
		await expect(button).not.toBeNull()
		await userEvent.click(button!)
		await expect(inspector()).toHaveTextContent(key)
	}
	const inspector = () => canvas.getByLabelText(`Passive ecology inspector`)
	const trace = () =>
		project(() =>
			userEvent.click(
				within(inspector()).getByRole(`button`, {
					name: `Trace observed roots`,
				}),
			),
		)
	return {
		action,
		controls,
		summary,
		ecology,
		ready,
		refresh,
		choose,
		inspector,
		trace,
	}
}

export const playPrimary: Play = async ({ canvas, userEvent, step }) => {
	await step(`The primary debugger uses its own store`, async () => {
		const tab = canvas.getByRole(`tab`, { name: `ecology` })
		if (tab.getAttribute(`aria-selected`) !== `true`) await userEvent.click(tab)
		await waitFor(() =>
			expect(canvas.getByTestId(`ecology-view`)).toHaveAttribute(
				`data-ready`,
				`true`,
			),
		)
		await expect(
			canvas.getByTestId(`ecology-view`).querySelector(`.ecology-counts`),
		).toHaveTextContent(/^11 atoms · 2 selectors/)
		await expect(
			canvas.getByTestId(`ecology-view`).querySelector(`.ecology-counts`),
		).toHaveTextContent(`0 captured edges`)
		await userEvent.click(canvas.getByRole(`button`, { name: `run` }))
		await expect(canvas.getAllByTestId(`atom-io-devtools`)).toHaveLength(1)
	})
}

export const playOrderRoots: Play = async (context) => {
	const { step, canvas } = context
	const tools = orderTools(context)
	await tools.ecology()
	await step(
		`Delivery and pickup retain the roots observed by the application`,
		async () => {
			await tools.choose(`fulfillmentFeeCents`)
			await tools.trace()
			await expect(tools.inspector()).toHaveTextContent(`deliveryRegion`)
			await expect(tools.inspector()).not.toHaveTextContent(`pickupStore`)
			await tools.action(`Use pickup`)
			await waitFor(() => expect(tools.summary()).toHaveTextContent(`pickup`))
			await tools.refresh()
			await tools.trace()
			await expect(tools.inspector()).toHaveTextContent(`pickupStore`)
			await expect(tools.inspector()).not.toHaveTextContent(`deliveryRegion`)
		},
	)
	await step(
		`Warehouse selection changes the observed stock roots`,
		async () => {
			await tools.choose(`availableLineCount`)
			await tools.trace()
			await expect(tools.inspector()).toHaveTextContent(
				`stockByWarehouseSku(["north","tea-green"])`,
			)
			await tools.action(`Use south warehouse`)
			await tools.refresh()
			await tools.trace()
			await expect(tools.inspector()).toHaveTextContent(
				`stockByWarehouseSku(["south","tea-green"])`,
			)
			await expect(tools.inspector()).not.toHaveTextContent(
				`stockByWarehouseSku(["north","tea-green"])`,
			)
		},
	)
	await step(
		`Passive inspection leaves dormant state and empty families untouched`,
		async () => {
			for (const key of [`seasonalPromotion`, `lazyAuditDefault("unused")`]) {
				await tools.choose(key)
				await tools.trace()
				await expect(tools.inspector()).toHaveTextContent(`not cached / unknown`)
			}
			await tools.choose(`wishlistNotesBySku`, true)
			await expect(tools.inspector()).toHaveTextContent(`0 instantiated members`)
			await expect(canvas.getAllByTestId(`atom-io-devtools`)).toHaveLength(1)
		},
	)
}

export const playOrderActions: Play = async (context) => {
	const { step, canvas } = context
	const tools = orderTools(context)
	await step(`A fresh story starts with the original order`, async () => {
		await expect(tools.summary()).toHaveTextContent(`6 cart lines`)
		await expect(tools.summary()).toHaveTextContent(
			`$40.25 total · delivery · north warehouse`,
		)
	})
	await step(`Cart membership appears in the real family`, async () => {
		await tools.ecology()
		await tools.action(`Add oolong tea`)
		await tools.refresh()
		await tools.choose(`cartQuantityBySku`, true)
		await expect(tools.inspector()).toHaveTextContent(`7 instantiated members`)
		await tools.action(`Remove oolong tea`)
		await tools.refresh()
		await expect(tools.inspector()).toHaveTextContent(`6 instantiated members`)
	})
	await step(
		`Quantity, undo, redo and coupon actions update the application`,
		async () => {
			await tools.action(`Two green teas`)
			await waitFor(() => expect(tools.summary()).toHaveTextContent(`$45.25`))
			await tools.action(`Undo cart`)
			await waitFor(() => expect(tools.summary()).toHaveTextContent(`$40.25`))
			await tools.action(`Redo cart`)
			await waitFor(() => expect(tools.summary()).toHaveTextContent(`$45.25`))
			await tools.action(`Apply PANTRY10`)
			await waitFor(() => expect(tools.summary()).toHaveTextContent(`$41.37`))
		},
	)
	await step(
		`Application-owned quotes have controlled pending and success/error outcomes`,
		async () => {
			for (const outcome of [`Resolve quote`, `Reject quote`]) {
				await tools.action(`Request quote`)
				await expect(
					canvas.getByLabelText(`Carrier quote status`),
				).toHaveTextContent(`pending`)
				await tools.action(outcome)
				await expect(
					canvas.getByLabelText(`Carrier quote status`),
				).toHaveTextContent(outcome === `Resolve quote` ? `ready` : `error`)
			}
		},
	)
}

export const playOrderEditingAndReset: Play = async (context) => {
	const { canvas, canvasElement, userEvent, step } = context
	const tools = orderTools(context)
	await tools.ecology()
	await step(
		`Explicit live editing updates the same application and retains its draft`,
		async () => {
			await tools.choose(`cartQuantityBySku("tea-green")`)
			await userEvent.click(
				within(tools.inspector()).getByRole(`button`, {
					name: `Open live editor (may read/evaluate)`,
				}),
			)
			const editor = canvasElement.querySelector<HTMLInputElement>(
				`.ecology-live input[inputmode="decimal"]`,
			)!
			await userEvent.clear(editor)
			await userEvent.type(editor, `2.`)
			await waitFor(() => expect(tools.summary()).toHaveTextContent(`$45.25`))
			await expect(editor).toHaveValue(`2.`)
		},
	)
	await step(
		`Repeated resets rebind one debugger to the fresh order store`,
		async () => {
			for (let reset = 0; reset < 3; reset++) {
				const previousPanel = canvas.getByTestId(`atom-io-devtools`)
				await tools.action(`Reset order scenario`)
				await waitFor(() => expect(previousPanel).not.toBeInTheDocument())
				await tools.controls(false)
				await waitFor(() =>
					expect(tools.summary()).toHaveTextContent(
						`$40.25 total · delivery · north warehouse`,
					),
				)
				await tools.ready()
				await expect(canvas.getAllByTestId(`atom-io-devtools`)).toHaveLength(1)
				await tools.choose(`fulfillmentFeeCents`)
				await tools.trace()
				await expect(tools.inspector()).toHaveTextContent(`deliveryRegion`)
				await expect(tools.inspector()).not.toHaveTextContent(`pickupStore`)
			}
		},
	)
}

export const playOrderHistorySearch: Play = async (context) => {
	const { canvas, canvasElement, userEvent, step } = context
	const tools = orderTools(context)
	await step(
		`Record a real cart transaction and navigate its captured update`,
		async () => {
			await tools.controls(false)
			await userEvent.click(canvas.getByRole(`tab`, { name: `transactions` }))
			await tools.action(`Two green teas`)
			await tools.controls(false)
			await userEvent.click(canvas.getByRole(`button`, { name: `Refresh` }))
		},
	)
	for (const view of [`transactions`, `timelines`]) {
		await step(
			`Search ${view} without changing the cart or undo/redo cursor`,
			async () => {
				if (view === `timelines`)
					await userEvent.click(canvas.getByRole(`tab`, { name: view }))
				const input = canvas.getByRole(`searchbox`, { name: `Search ${view}` })
				await userEvent.type(input, `cartQuantityBySku`)
				await waitFor(() =>
					expect(
						canvasElement.querySelectorAll(`.search-results button`).length,
					).toBeGreaterThan(0),
				)
				const before = tools.summary().textContent
				await userEvent.keyboard(`{ArrowDown}{Enter}`)
				await waitFor(() =>
					expect(
						canvasElement.querySelector(`[data-search-selected="true"]`),
					).not.toBeNull(),
				)
				await expect(tools.summary().textContent).toBe(before)
				await expect(
					canvasElement.querySelector(`.search-details`),
				).toHaveTextContent(`no history cursor changed`)
				await userEvent.keyboard(`{Escape}`)
				await expect(input).toHaveFocus()
			},
		)
	}
}
