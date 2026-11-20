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
		const open = canvas.queryByRole(`button`, {
			name: `Open debugger`,
		})
		if (open) await userEvent.click(open)
		const tab = await canvas.findByRole(`tab`, { name: `ecology` })
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
	const search = async () => {
		const graph = canvas.getByTestId(`ecology-view`)
		const input = graph.querySelector<HTMLInputElement>(`input[type="search"]`)!
		if (!input.checkVisibility())
			await userEvent.click(
				graph.querySelector<HTMLButtonElement>(`[data-action="search"]`)!,
			)
		await waitFor(() => expect(input).toBeVisible())
		await userEvent.click(input)
		await waitFor(async () => {
			input.focus()
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => {
					resolve()
				}),
			)
			await expect(input).toHaveFocus()
		})
		return input
	}
	const choose = async (key: string, family = false) => {
		await debuggerVisible(true)
		const input = await search()
		await project(async () => {
			await userEvent.clear(input)
			await userEvent.type(input, key, { skipClick: true })
			await expect(input).toHaveValue(key)
		})
		const graph = canvas.getByTestId(`ecology-view`)
		const id = `${family ? `family` : `state`}:${key}`
		// Ranked navigation explicitly reveals a member of a collapsed family.
		const result = graph.querySelector<HTMLElement>(
			`[data-results] button[data-result-id=${JSON.stringify(id)}]`,
		)
		await expect(result).not.toBeNull()
		await project(() => userEvent.click(result!))
		const button = graph.querySelector<HTMLElement>(
			`ecology-editor-row:not([hidden]) button[data-graph-id=${JSON.stringify(id)}]`,
		)
		await expect(button).not.toBeNull()
		await userEvent.click(button!)
		await expect(button).toHaveAccessibleName(key)
	}
	const inspector = () =>
		canvasElement.querySelector<HTMLElement>(
			`ecology-editor-row[data-section="selected"]`,
		)!
	const related = (key: string) =>
		canvasElement.querySelector(
			`ecology-node-card[data-traced="true"]:not([inert]) > button[data-graph-id="state:${CSS.escape(key)}"]`,
		)
	return {
		action,
		related,
		debuggerVisible,
		scenarioControls,
		summary,
		ecology,
		ready,
		project,
		refresh,
		choose,
		search,
		inspector,
	}
}

/** Open the unmodified storefront model for manual ecology development. */
export const playEcologySandbox: Play = async (context) => {
	await orderTools(context).ecology()
}

export const playPrimary: Play = async ({ canvas, userEvent, step }) => {
	await step(`The primary debugger uses its own store`, async () => {
		const tab = await canvas.findByRole(`tab`, { name: `ecology` })
		if (tab.getAttribute(`aria-selected`) !== `true`) await userEvent.click(tab)
		await waitFor(() =>
			expect(canvas.getByTestId(`ecology-view`)).toHaveAttribute(
				`data-ready`,
				`true`,
			),
		)
		await expect(canvas.getByTestId(`ecology-view`).dataset[`counts`]).toContain(
			`11 atoms · 2 selectors`,
		)
		await expect(canvas.getByTestId(`ecology-view`).dataset[`counts`]).toContain(
			`0 captured edges`,
		)
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
			await expect(tools.related(`deliveryRegion`)).not.toBeNull()
			await expect(tools.related(`pickupStore`)).toBeNull()
			await tools.action(`Use pickup`)
			await waitFor(() => expect(tools.summary()).toHaveTextContent(`pickup`))
			await tools.refresh()
			await expect(tools.related(`pickupStore`)).not.toBeNull()
			await expect(tools.related(`deliveryRegion`)).toBeNull()
		},
	)
	await step(
		`Warehouse selection changes the observed stock roots`,
		async () => {
			await tools.choose(`stockByWarehouseSku`, true)
			await tools.project(() =>
				context.userEvent.click(
					canvas.getByRole(`button`, {
						name: /^Expand stockByWarehouseSku$/,
					}),
				),
			)
			await tools.choose(`availableLineCount`)
			await expect(
				tools.related(`stockByWarehouseSku(["north","tea-green"])`),
			).not.toBeNull()
			await tools.action(`Use south warehouse`)
			await tools.refresh()
			await expect(
				tools.related(`stockByWarehouseSku(["south","tea-green"])`),
			).not.toBeNull()
			await expect(
				tools.related(`stockByWarehouseSku(["north","tea-green"])`),
			).toBeNull()
		},
	)
	await step(
		`Passive inspection leaves dormant state and empty families untouched`,
		async () => {
			for (const key of [`seasonalPromotion`, `lazyAuditDefault("unused")`]) {
				await tools.choose(key)
				await expect(tools.inspector()).toHaveTextContent(`Generate`)
			}
			await tools.choose(`wishlistNotesBySku`, true)
			await expect(tools.inspector()).toHaveTextContent(`0 members`)
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
		await expect(tools.inspector()).toHaveTextContent(`7 members`)
		await tools.action(`Remove tea oolong`)
		await tools.refresh()
		await expect(tools.inspector()).toHaveTextContent(`6 members`)
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
				await waitFor(() =>
					expect(
						canvas.getByLabelText(`Carrier quote status`),
					).toHaveTextContent(outcome === `Resolve quote` ? `ready` : `error`),
				)
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
			const editor = canvasElement.querySelector<HTMLInputElement>(
				`ecology-editor-row[data-section="selected"] input[inputmode="decimal"]`,
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
				await expect(tools.related(`deliveryRegion`)).not.toBeNull()
				await expect(tools.related(`pickupStore`)).toBeNull()
			}
		},
	)
}

export const playEcologySearch: Play = async (context) => {
	const { canvas, canvasElement, userEvent, step } = context
	const tools = orderTools(context)
	await tools.ecology()
	await tools.choose(`checkoutTotalCents`)
	const input = canvasElement.querySelector<HTMLInputElement>(
		`ecology-view input[type="search"]`,
	)!
	const ready = () =>
		waitFor(() =>
			expect(canvas.getByTestId(`ecology-view`)).toHaveAttribute(
				`data-ready`,
				`true`,
			),
		)
	await step(
		`Rank normalized captured metadata and preserve the selected node`,
		async () => {
			await tools.search()
			await userEvent.clear(input)
			await userEvent.type(input, `CHECKOUT total`, { skipClick: true })
			await ready()
			const result = canvasElement.querySelector<HTMLElement>(
				`ecology-view [data-results] button[data-result-id="state:checkoutTotalCents"]`,
			)!
			await expect(result).not.toBeNull()
			await userEvent.click(result)
			await ready()
			await expect(tools.inspector()).toHaveAttribute(
				`data-row-id`,
				`state:checkoutTotalCents`,
			)
			await expect(
				canvasElement
					.querySelector(`ecology-editor`)!
					.contains(document.activeElement) ||
					tools.inspector().contains(document.activeElement),
			).toBe(true)
		},
	)
	await step(
		`Search and select metadata while retaining an unfinished live edit`,
		async () => {
			await tools.choose(`cartQuantityBySku("tea-green")`)
			const editor = canvasElement.querySelector<HTMLInputElement>(
				`ecology-editor-row[data-section="selected"] input[inputmode="decimal"]`,
			)!
			await userEvent.clear(editor)
			await userEvent.type(editor, `2e`)
			const summary = tools.summary().textContent
			await tools.search()
			await userEvent.click(input)
			await userEvent.clear(input)
			await userEvent.type(input, `availability`, { skipClick: true })
			await ready()
			await expect(editor).toHaveValue(`2e`)
			await expect(
				canvasElement.querySelector(
					`ecology-editor-row[data-section="selected"] input[inputmode="decimal"]`,
				),
			).toBe(editor)
			await expect(tools.summary().textContent).toBe(summary)
			await userEvent.keyboard(`{ArrowDown}{Enter}`)
			await ready()
			await expect(editor).toHaveValue(`2e`)
			await tools.search()
			await userEvent.click(input)
			const modalSearch = input.closest(`dialog`)!.matches(`:modal`)
			await userEvent.keyboard(`{Escape}`)
			if (!modalSearch) {
				await ready()
				await userEvent.keyboard(`{Escape}`)
				await ready()
				await userEvent.keyboard(`{Escape}`)
			}
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
				canvas.getByLabelText(`Carrier quote status`),
			).toHaveTextContent(`idle`)
			await expect(canvas.getByText(/no quote requested/)).toBeVisible()
			await expect(
				canvas.getByRole(`button`, { name: `Resolve quote` }),
			).toBeDisabled()
			await tools.action(`Request quote`)
			await expect(
				canvas.getByRole(`button`, { name: `Reject quote` }),
			).toBeEnabled()
			await tools.action(`Reject quote`)
			await waitFor(() =>
				expect(canvas.getByLabelText(`Carrier quote status`)).toHaveTextContent(
					`error`,
				),
			)
			await expect(
				canvas.getByRole(`button`, { name: `Reject quote` }),
			).toBeDisabled()
			await tools.action(`Request quote`)
			await expect(canvas.getByText(/waiting for carrier/)).toBeVisible()
			await tools.action(`Resolve quote`)
			await waitFor(() =>
				expect(canvas.getByLabelText(`Carrier quote status`)).toHaveTextContent(
					`ready`,
				),
			)
			await expect(
				canvas.getByLabelText(`Carrier quote status`).parentElement,
			).toHaveTextContent(`$6.50`)
		},
	)
	await step(
		`A nested numeric editor keeps a focused unfinished price`,
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
