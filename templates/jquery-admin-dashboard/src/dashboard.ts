import type { ReadableToken, ViewOf } from "atom.io"
import {
	getState,
	inspectTimeline,
	redo,
	runTransaction,
	setState,
	subscribe,
	undo,
} from "atom.io"
import $ from "jquery"

import { isPlan, isStatus, PLANS } from "./data.ts"
import {
	addCustomerTransaction,
	customersTimeline,
	filterCustomersTransaction,
	filterAtom,
	metricsSelector,
	searchAtom,
	selectedIdsAtom,
	sortAtom,
	updateStatusTransaction,
	visibleCustomersSelector,
} from "./state.ts"
import markup from "./dashboard.html?raw"

const currency = new Intl.NumberFormat(`en-US`, {
	style: `currency`,
	currency: `USD`,
	maximumFractionDigits: 0,
})

export function mountDashboard(root: HTMLElement): () => void {
	const $root = $(root).html(markup)
	const cleanups: (() => void)[] = []
	const $dialog = $root.find<HTMLDialogElement>(`#customer-dialog`)
	const dialog = $dialog[0]
	const form = $root.find<HTMLFormElement>(`#customer-form`)[0]

	// A small bridge is all jQuery needs: render once, then subscribe to atom.io.
	function watch<T>(
		token: ReadableToken<T>,
		render: (value: ViewOf<T>) => void,
	): void {
		render(getState(token))
		cleanups.push(
			subscribe(token, ({ newValue }) => {
				render(newValue)
			}),
		)
	}
	function announce(message: string): void {
		$root.find(`#announcement`).text(message).prop(`hidden`, false)
	}
	function renderSelection(): void {
		const selected = getState(selectedIdsAtom)
		const visible = getState(visibleCustomersSelector)
		const count = visible.filter((customer) =>
			selected.includes(customer.id),
		).length
		$root.find(`#select-all`).prop({
			checked: visible.length > 0 && count === visible.length,
			indeterminate: count > 0 && count < visible.length,
			disabled: visible.length === 0,
		})
		$root.find<HTMLInputElement>(`[data-select]`).each((_index, input) => {
			input.checked = selected.includes(input.value)
		})
		$root.find(`#bulk-actions`).prop(`hidden`, selected.length === 0)
		$root.find(`#selection-count`).text(`${selected.length} selected`)
	}
	function renderHistory(): void {
		const { at, length } = inspectTimeline(customersTimeline)
		$root.find(`#undo`).prop(`disabled`, at === 0)
		$root.find(`#redo`).prop(`disabled`, at === length)
	}

	watch(metricsSelector, (metrics) => {
		$root.find(`#metric-total, #customer-count, #nav-count`).text(metrics.total)
		$root.find(`#metric-active`).text(metrics.active)
		$root.find(`#metric-trial`).text(metrics.trial)
		$root.find(`#metric-mrr`).text(currency.format(metrics.mrr))
		const $plans = $root.find(`#plan-revenue`).empty()
		for (const [plan, revenue] of Object.entries(metrics.byPlan)) {
			const percent =
				metrics.mrr === 0 ? 0 : Math.round((revenue / metrics.mrr) * 100)
			$(`<div>`)
				.addClass(`plan`)
				.append(
					$(`<div>`)
						.addClass(`plan-label`)
						.append(
							$(`<span>`).text(plan),
							$(`<strong>`).text(currency.format(revenue)),
						),
				)
				.append(
					$(`<div>`)
						.addClass(`plan-track`)
						.attr(`aria-hidden`, `true`)
						.append($(`<span>`).css(`width`, `${percent}%`)),
				)
				.append($(`<small>`).text(`${percent}% of MRR`))
				.appendTo($plans)
		}
	})
	watch(visibleCustomersSelector, (customers) => {
		const $rows = $root.find(`#customer-rows`).empty()
		for (const customer of customers) {
			const initials = customer.name
				.split(/\s+/)
				.map((part) => part[0])
				.slice(0, 2)
				.join(``)
			// Customer values enter the DOM through .text() and .attr(), never HTML strings.
			$(`<tr>`)
				.append(
					$(`<td>`)
						.addClass(`checkbox-cell`)
						.append(
							$(`<input>`)
								.attr({
									type: `checkbox`,
									"data-select": ``,
									"aria-label": `Select ${customer.name}`,
								})
								.val(customer.id),
						),
				)
				.append(
					$(`<td>`).append(
						$(`<div>`)
							.addClass(`customer-name`)
							.append(
								$(`<span>`).addClass(`avatar`).text(initials),
								$(`<div>`).append(
									$(`<strong>`).text(customer.name),
									$(`<small>`).text(customer.email),
								),
							),
					),
				)
				.append($(`<td>`).text(customer.company))
				.append(
					$(`<td>`).append(
						$(`<span>`).addClass(`plan-badge`).text(customer.plan),
					),
				)
				.append(
					$(`<td>`).append(
						$(`<span>`)
							.addClass(`status ${customer.status}`)
							.text(customer.status),
					),
				)
				.append(
					$(`<td>`)
						.addClass(`numeric`)
						.text(
							currency.format(
								customer.status === `active` ? PLANS[customer.plan] : 0,
							),
						),
				)
				.appendTo($rows)
		}
		$root.find(`#empty-state`).prop(`hidden`, customers.length !== 0)
		$root
			.find(`#results-count`)
			.text(
				`Showing ${customers.length} of ${getState(metricsSelector).total} customers`,
			)
		renderSelection()
	})
	watch(selectedIdsAtom, renderSelection)
	watch(searchAtom, (query) => {
		$root.find(`#search`).val(query)
	})
	watch(filterAtom, (filter) => {
		$root.find<HTMLButtonElement>(`[data-filter]`).each((_index, button) => {
			$(button).attr(`aria-pressed`, String(button.dataset[`filter`] === filter))
		})
	})
	watch(sortAtom, (sort) => {
		$root.find(`#sort`).val(sort)
	})
	renderHistory()
	cleanups.push(subscribe(customersTimeline, renderHistory))

	$root.on(`input.dashboard`, `#search`, (event) => {
		runTransaction(filterCustomersTransaction)(
			String($(event.currentTarget).val() ?? ``),
			getState(filterAtom),
		)
	})
	$root.on(`click.dashboard`, `[data-filter]`, (event) => {
		const filter = $(event.currentTarget).attr(`data-filter`)
		if (filter === `all` || isStatus(filter))
			runTransaction(filterCustomersTransaction)(getState(searchAtom), filter)
	})
	$root.on(`change.dashboard`, `#sort`, (event) => {
		const sort = $(event.currentTarget).val()
		if (sort === `name` || sort === `company` || sort === `revenue`)
			setState(sortAtom, sort)
	})
	$root.on(`change.dashboard`, `[data-select]`, (event) => {
		const $input = $(event.currentTarget)
		const id = String($input.val())
		setState(selectedIdsAtom, (ids) =>
			$input.prop(`checked`)
				? [...new Set([...ids, id])]
				: ids.filter((selected) => selected !== id),
		)
	})
	$root.on(`change.dashboard`, `#select-all`, (event) => {
		setState(
			selectedIdsAtom,
			$(event.currentTarget).prop(`checked`)
				? getState(visibleCustomersSelector).map((customer) => customer.id)
				: [],
		)
	})
	$root.on(`click.dashboard`, `[data-bulk-status]`, (event) => {
		const status = $(event.currentTarget).attr(`data-bulk-status`)
		if (!isStatus(status)) return
		const ids = getState(selectedIdsAtom)
		runTransaction(updateStatusTransaction)(ids, status)
		announce(
			`${ids.length} customer${ids.length === 1 ? `` : `s`} set to ${status}.`,
		)
	})
	$root.on(`click.dashboard`, `#clear-selection`, () => {
		setState(selectedIdsAtom, [])
	})
	$root.on(`click.dashboard`, `#clear-filters`, () => {
		runTransaction(filterCustomersTransaction)(``, `all`)
	})
	$root.on(`click.dashboard`, `#undo, #redo`, (event) => {
		setState(selectedIdsAtom, [])
		if ($(event.currentTarget).is(`#undo`)) {
			undo(customersTimeline)
			announce(`Customer change undone.`)
		} else {
			redo(customersTimeline)
			announce(`Customer change redone.`)
		}
	})
	$root.on(`click.dashboard`, `#add-customer`, () => {
		form.reset()
		$root.find(`#form-error`).text(``)
		dialog.showModal()
	})
	$root.on(`click.dashboard`, `#close-dialog, #cancel-customer`, () => {
		dialog.close()
	})
	$root.on(`submit.dashboard`, `#customer-form`, (event) => {
		event.preventDefault()
		if (!form.reportValidity()) return
		const values = new FormData(form)
		const plan = values.get(`plan`)
		const status = values.get(`status`)
		if (!isPlan(plan) || !isStatus(status)) return
		const name = values.get(`name`)
		const email = values.get(`email`)
		const company = values.get(`company`)
		if (
			typeof name !== `string` ||
			typeof email !== `string` ||
			typeof company !== `string`
		)
			return
		const error = runTransaction(addCustomerTransaction)({
			id: crypto.randomUUID(),
			name,
			email,
			company,
			plan,
			status,
		})
		$root.find(`#form-error`).text(error ?? ``)
		if (error) return
		dialog.close()
		announce(`${name.trim()} added to your customers.`)
	})

	return () => {
		for (const unsubscribe of cleanups) unsubscribe()
		$root.off(`.dashboard`).empty()
	}
}
