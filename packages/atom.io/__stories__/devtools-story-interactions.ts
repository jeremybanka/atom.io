import type { StoryObj } from "@storybook/react-vite"
import { expect, waitFor, within } from "storybook/test"

type Play = NonNullable<StoryObj[`play`]>
type Context = Parameters<Play>[0]

function orderTools({ canvas, canvasElement, userEvent }: Context) {
	const debuggerVisible = async (visible: boolean) => {
		const panel = await waitFor(() => canvas.getByTestId(`atom-io-devtools`))
		if (panel.hidden === visible)
			await userEvent.keyboard(`{Control>}{Shift>}a{/Shift}{/Control}`)
		await waitFor(() => expect(panel.hidden).toBe(!visible))
	}
	const scenarioControls = async () => {
		const details = canvasElement.querySelector<HTMLDetailsElement>(
			`order-summary > details`,
		)!
		if (!details.open) await userEvent.click(details.querySelector(`summary`)!)
	}
	const action = async (name: string) => {
		await debuggerVisible(false)
		if (name.endsWith(`quote`) || name === `Reset order scenario`)
			await scenarioControls()
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
		await debuggerVisible(true)
		const tab = canvas.getByRole(`tab`, { name: `ecology` })
		if (tab.getAttribute(`aria-selected`) !== `true`) await userEvent.click(tab)
		await ready()
	}
	const project = async (run: () => Promise<void>) => {
		await debuggerVisible(true)
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
		await debuggerVisible(true)
		const input = canvas.getByRole(`searchbox`, { name: `Search ecology` })
		await project(async () => {
			await userEvent.clear(input)
			await userEvent.type(input, key)
		})
		const graph = canvas.getByTestId(`ecology-view`)
		const switcher = within(graph).getByRole(`button`, { name: `Node list` })
		if (switcher.checkVisibility()) await userEvent.click(switcher)
		const details =
			graph.querySelector<HTMLDetailsElement>(`ecology-map details`)!
		if (!details.open) await userEvent.click(details.querySelector(`summary`)!)
		const id = `${family ? `family` : `state`}:${key}`
		const button = graph.querySelector<HTMLElement>(
			`ecology-map ul button[data-graph-id=${JSON.stringify(id)}]`,
		)
		await expect(button).not.toBeNull()
		await userEvent.click(button!)
		await expect(inspector()).toHaveTextContent(key)
	}
	const inspector = () => canvas.getByLabelText(`Passive ecology inspector`)
	const trace = () =>
		project(async () => {
			const selection = canvas.getByRole(`button`, { name: `Selection` })
			if (selection.checkVisibility()) await userEvent.click(selection)
			await userEvent.click(
				within(inspector()).getByRole(`button`, {
					name: `Trace observed roots`,
				}),
			)
		})
	return {
		action,
		debuggerVisible,
		scenarioControls,
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
			canvas
				.getByTestId(`ecology-view`)
				.querySelector(`ecology-view [data-counts]`),
		).toHaveTextContent(/^11 atoms · 2 selectors/)
		await expect(
			canvas
				.getByTestId(`ecology-view`)
				.querySelector(`ecology-view [data-counts]`),
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
		await tools.action(`Use south warehouse`)
		await tools.action(`Add tea oolong`)
		await tools.refresh()
		await tools.choose(`cartQuantityBySku`, true)
		await expect(tools.inspector()).toHaveTextContent(`7 instantiated members`)
		await tools.action(`Remove tea oolong`)
		await tools.refresh()
		await expect(tools.inspector()).toHaveTextContent(`6 instantiated members`)
	})
	await step(
		`Quantity, undo, redo and coupon actions update the application`,
		async () => {
			await tools.action(`Increase tea green`)
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
				`ecology-live input[inputmode="decimal"]`,
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
				await tools.debuggerVisible(true)
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
			await tools.debuggerVisible(true)
			await userEvent.click(canvas.getByRole(`tab`, { name: `transactions` }))
			await tools.action(`Increase tea green`)
			await tools.debuggerVisible(true)
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
						canvasElement.querySelectorAll(`search-results button`).length,
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
					canvasElement.querySelector(`search-details`),
				).toHaveTextContent(`no history cursor changed`)
				await userEvent.keyboard(`{Escape}`)
				await expect(input).toHaveFocus()
				const capture = canvasElement.querySelector<HTMLDetailsElement>(
					`search-controls details[data-capture]`,
				)!
				const disclosure = capture.querySelector(`summary`)!
				await userEvent.click(disclosure)
				await expect(capture).toHaveAttribute(`open`)
				await expect(capture).toHaveTextContent(
					`Opaque payloads are skipped; no actions replayed`,
				)
				await userEvent.click(disclosure)
				await expect(capture).not.toHaveAttribute(`open`)
				await expect(disclosure).toHaveFocus()
				await expect(tools.summary().textContent).toBe(before)
			},
		)
	}
}

export const playEcologySearch: Play = async (context) => {
	const { canvas, canvasElement, userEvent, step } = context
	const tools = orderTools(context)
	await tools.ecology()
	await tools.choose(`checkoutTotalCents`)
	await tools.trace()
	const input = canvas.getByRole(`searchbox`, { name: `Search ecology` })
	const ready = () =>
		waitFor(() =>
			expect(canvas.getByTestId(`ecology-view`)).toHaveAttribute(
				`data-ready`,
				`true`,
			),
		)
	await step(
		`Rank normalized captured metadata and preserve the same node's trace`,
		async () => {
			await userEvent.clear(input)
			await userEvent.type(input, `CHECKOUT total`)
			await ready()
			const result = canvasElement.querySelector<HTMLElement>(
				`ecology-view [data-results] button[data-result-id="state:checkoutTotalCents"]`,
			)!
			await expect(result).not.toBeNull()
			await userEvent.click(result)
			await ready()
			await expect(tools.inspector()).toHaveTextContent(`Retained trace`)
			await expect(
				canvasElement
					.querySelector(`ecology-map ul`)!
					.contains(document.activeElement) ||
					tools.inspector().contains(document.activeElement),
			).toBe(true)
		},
	)
	await step(
		`Search and select metadata while retaining an unfinished live edit`,
		async () => {
			await tools.choose(`cartQuantityBySku("tea-green")`)
			await userEvent.click(
				within(tools.inspector()).getByRole(`button`, {
					name: `Open live editor (may read/evaluate)`,
				}),
			)
			const editor = canvasElement.querySelector<HTMLInputElement>(
				`ecology-live input[inputmode="decimal"]`,
			)!
			await userEvent.clear(editor)
			await userEvent.type(editor, `2e`)
			const summary = tools.summary().textContent
			await userEvent.click(input)
			await userEvent.clear(input)
			await userEvent.type(input, `availability`)
			await ready()
			await expect(editor).toHaveValue(`2e`)
			await expect(
				canvasElement.querySelector(`ecology-live input[inputmode="decimal"]`),
			).toBe(editor)
			await expect(tools.summary().textContent).toBe(summary)
			await userEvent.keyboard(`{ArrowDown}{Enter}`)
			await ready()
			await expect(editor).toHaveValue(`2e`)
			await userEvent.click(input)
			await userEvent.keyboard(`{Escape}`)
			await ready()
			await userEvent.keyboard(`{Escape}`)
			await expect(editor).toHaveFocus()
		},
	)
}

export const playSurfaceStates: Play = async (context) => {
	const { canvas, userEvent, step } = context
	const tools = orderTools(context)
	await step(
		`Quote controls communicate disabled, pending and error outcomes`,
		async () => {
			await tools.debuggerVisible(false)
			await tools.scenarioControls()
			await expect(
				canvas.getByRole(`button`, { name: `Resolve quote` }),
			).toBeDisabled()
			await tools.action(`Request quote`)
			await expect(
				canvas.getByRole(`button`, { name: `Reject quote` }),
			).toBeEnabled()
			await tools.action(`Reject quote`)
			await expect(
				canvas.getByLabelText(`Carrier quote status`),
			).toHaveTextContent(`error`)
			await expect(
				canvas.getByRole(`button`, { name: `Reject quote` }),
			).toBeDisabled()
		},
	)
	await step(
		`Nested editors and passive search retain a focused unfinished price`,
		async () => {
			await tools.debuggerVisible(true)
			await userEvent.click(canvas.getByRole(`tab`, { name: `atoms` }))
			const family = canvas.getByTestId(`open-close-state-family-productBySku`)
			if (family.getAttribute(`aria-expanded`) !== `true`)
				await userEvent.click(family)
			const member = canvas.getByTestId(`state-value-productBySku("tea-green")`)
			await userEvent.click(
				within(member).getByRole(`button`, { name: /^Expand/ }),
			)
			await userEvent.click(
				within(member).getByRole(`button`, { name: `Expand tags` }),
			)
			const price = within(member).getByRole(`textbox`, {
				name: `priceCents`,
			})
			await userEvent.clear(price)
			await userEvent.type(price, `500.`)
			await userEvent.keyboard(`{Control>}{Shift>}f{/Shift}{/Control}`)
			const search = canvas.getByRole(`searchbox`, { name: `Search atoms` })
			await userEvent.type(search, `product tea`)
			await waitFor(() => expect(price).toHaveValue(`500.`))
			await userEvent.keyboard(`{Escape}{Escape}`)
			await expect(price).toHaveFocus()
			await expect(price).toHaveValue(`500.`)
		},
	)
}

export const playStorefront: Play = async (context) => {
	const { canvas, canvasElement, userEvent, step } = context
	const tools = orderTools(context)
	await step(
		`Browse real stock, add any catalog item and change its quantity`,
		async () => {
			await tools.debuggerVisible(false)
			await expect(canvasElement.querySelectorAll(`catalog-item`)).toHaveLength(
				24,
			)
			await expect(
				canvas.getByRole(`button`, { name: `Add tea oolong` }),
			).toBeDisabled()
			await tools.action(`Add pantry 2`)
			await expect(tools.summary()).toHaveTextContent(`7 cart lines`)
			await expect(
				canvas.getByLabelText(`pantry 2 line total`),
			).toHaveTextContent(`$7.00`)
			await tools.action(`Increase pantry 2`)
			await expect(canvas.getByLabelText(`pantry 2 quantity`)).toHaveTextContent(
				`2`,
			)
			await expect(
				canvas.getByLabelText(`pantry 2 line total`),
			).toHaveTextContent(`$14.00`)
			await tools.action(`Decrease pantry 2`)
			await tools.action(`Remove pantry 2`)
			await tools.action(`Undo cart`)
			await expect(canvas.getByLabelText(`pantry 2 quantity`)).toHaveTextContent(
				`1`,
			)
			await tools.action(`Redo cart`)
			await expect(tools.summary()).toHaveTextContent(`6 cart lines`)
		},
	)
	await step(
		`An empty cart stays usable and reset restores the isolated order`,
		async () => {
			for (const row of canvasElement.querySelectorAll(`cart-line`))
				await userEvent.click(
					within(row as HTMLElement).getByRole(`button`, { name: /^Remove / }),
				)
			await expect(tools.summary()).toHaveTextContent(`0 cart lines`)
			await expect(
				canvas.getByText(
					`Your cart is empty. Find something in the catalog below.`,
				),
			).toBeVisible()
			await tools.action(`Use pickup`)
			await expect(canvas.getByLabelText(`Order total`)).toHaveTextContent(
				`$2.00`,
			)
			await tools.action(`Reset order scenario`)
			await expect(tools.summary()).toHaveTextContent(
				`$40.25 total · delivery · north warehouse`,
			)
		},
	)
}
