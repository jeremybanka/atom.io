import {
	clearTimeline,
	getState,
	inspectTimeline,
	redo,
	runTransaction,
	setState,
	undo,
} from "atom.io"
import $ from "jquery"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { mountDashboard } from "../src/dashboard.ts"
import { INITIAL_CUSTOMERS } from "../src/data.ts"
import {
	addCustomerTransaction,
	customersAtom,
	customersTimeline,
	filterCustomersTransaction,
	filterAtom,
	metricsSelector,
	searchAtom,
	selectedIdsAtom,
	sortAtom,
	updateStatusTransaction,
	visibleCustomersSelector,
} from "../src/state.ts"

let unmount: (() => void) | undefined

beforeEach(() => {
	setState(customersAtom, INITIAL_CUSTOMERS)
	runTransaction(filterCustomersTransaction)(``, `all`)
	setState(sortAtom, `name`)
	clearTimeline(customersTimeline)
	document.body.innerHTML = `<div id="app"></div>`
})

afterEach(() => {
	unmount?.()
	unmount = undefined
})

function mount(): void {
	unmount = mountDashboard(document.querySelector<HTMLElement>(`#app`)!)
}

describe(`customer workflows`, () => {
	it(`filters case-insensitively, clears hidden selection, and keeps workspace totals independent`, () => {
		setState(selectedIdsAtom, [`c1`])
		runTransaction(filterCustomersTransaction)(`  LANA@EXAMPLE.COM  `, `trial`)
		expect(
			getState(visibleCustomersSelector).map((customer) => customer.id),
		).toEqual([`c3`])
		expect(getState(selectedIdsAtom)).toEqual([])
		expect(getState(metricsSelector)).toMatchObject({
			total: 10,
			active: 6,
			trial: 2,
			mrr: 1544,
		})
		expect(inspectTimeline(customersTimeline).length).toBe(0)
	})

	it(`updates a group as one undo step and restores derived revenue on undo and redo`, () => {
		runTransaction(updateStatusTransaction)([`c1`, `c2`], `paused`)
		expect(getState(metricsSelector).mrr).toBe(996)
		expect(inspectTimeline(customersTimeline).length).toBe(1)
		runTransaction(filterCustomersTransaction)(`Layers`, `all`)
		undo(customersTimeline)
		expect(getState(metricsSelector).mrr).toBe(1544)
		expect(getState(searchAtom)).toBe(`Layers`)
		redo(customersTimeline)
		expect(getState(metricsSelector).mrr).toBe(996)
	})

	it(`does not record a no-op status update`, () => {
		runTransaction(updateStatusTransaction)([`c1`, `missing`], `active`)
		expect(inspectTimeline(customersTimeline).length).toBe(0)
	})

	it(`validates new customers and rejects duplicate email without adding history`, () => {
		const customer = {
			id: `new`,
			name: ` New Person `,
			email: ` NEW@EXAMPLE.COM `,
			company: ` New Co `,
			plan: `Growth`,
			status: `active`,
		} as const
		expect(
			runTransaction(addCustomerTransaction)({ ...customer, email: `bad` }),
		).toContain(`valid email`)
		expect(
			runTransaction(addCustomerTransaction)({
				...customer,
				email: `OLIVIA@EXAMPLE.COM`,
			}),
		).toContain(`already exists`)
		expect(inspectTimeline(customersTimeline).length).toBe(0)
		runTransaction(filterCustomersTransaction)(`missing`, `paused`)
		expect(runTransaction(addCustomerTransaction)(customer)).toBeNull()
		expect(getState(customersAtom).at(-1)).toMatchObject({
			name: `New Person`,
			email: `new@example.com`,
			company: `New Co`,
		})
		expect(getState(filterAtom)).toBe(`all`)
		expect(getState(searchAtom)).toBe(``)
		expect(getState(metricsSelector).mrr).toBe(1693)
		undo(customersTimeline)
		expect(getState(customersAtom)).toHaveLength(10)
	})
})

describe(`jQuery view`, () => {
	it(`keeps duplicate email errors in the dialog and submits a corrected customer`, () => {
		mount()
		$(`#add-customer`).trigger(`click`)
		$(`[name="name"]`).val(`New Customer`)
		$(`[name="email"]`).val(`olivia@example.com`)
		$(`[name="company"]`).val(`New Company`)
		$(`#customer-form`).trigger(`submit`)
		expect($(`#form-error`).text()).toContain(`already exists`)
		expect($(`#customer-dialog`).prop(`open`)).toBe(true)
		$(`[name="email"]`).val(`new@example.com`)
		$(`#customer-form`).trigger(`submit`)
		expect($(`#customer-dialog`).prop(`open`)).toBe(false)
		expect($(`#customer-rows tr`)).toHaveLength(11)
		expect($(`#metric-trial`).text()).toBe(`3`)
		$(`#undo`).trigger(`click`)
		expect($(`#customer-rows tr`)).toHaveLength(10)
	})

	it(`uses jQuery 4 and handles search, visible selection, bulk status, and history controls`, () => {
		mount()
		expect($.fn.jquery).toMatch(/^4\./)
		expect($(`#customer-rows tr`)).toHaveLength(10)
		$(`#search`).val(`Layers`).trigger(`input`)
		expect($(`#customer-rows tr`)).toHaveLength(1)
		$(`#select-all`).prop(`checked`, true).trigger(`change`)
		expect(getState(selectedIdsAtom)).toEqual([`c1`])
		$(`[data-bulk-status="paused"]`).trigger(`click`)
		expect($(`#metric-mrr`).text()).toBe(`$1,145`)
		expect($(`#undo`).prop(`disabled`)).toBe(false)
		$(`#undo`).trigger(`click`)
		expect($(`#metric-mrr`).text()).toBe(`$1,544`)
		expect($(`#search`).val()).toBe(`Layers`)
		$(`#redo`).trigger(`click`)
		expect($(`#metric-mrr`).text()).toBe(`$1,145`)
	})

	it(`shows an empty state, clears filters, and sorts by active revenue`, () => {
		mount()
		$(`#search`).val(`not a customer`).trigger(`input`)
		expect($(`#empty-state`).prop(`hidden`)).toBe(false)
		expect($(`#select-all`).prop(`disabled`)).toBe(true)
		$(`#clear-filters`).trigger(`click`)
		$(`[data-filter="active"]`).trigger(`click`)
		$(`#sort`).val(`revenue`).trigger(`change`)
		expect($(`#customer-rows tr`)).toHaveLength(6)
		expect($(`#customer-rows tr`).first().find(`.numeric`).text()).toBe(`$399`)
		expect($(`[data-filter="active"]`).attr(`aria-pressed`)).toBe(`true`)
	})

	it(`renders user content as text and removes subscriptions and handlers on unmount`, () => {
		mount()
		runTransaction(addCustomerTransaction)({
			id: `unsafe`,
			name: `<img src=x onerror=alert(1)>`,
			company: `<script>bad()</script>`,
			email: `test@example.com`,
			plan: `Starter`,
			status: `trial`,
		})
		expect($(`#customer-rows`).text()).toContain(`<img src=x onerror=alert(1)>`)
		expect($(`#customer-rows img, #customer-rows script`)).toHaveLength(0)
		unmount!()
		$(`#app`).html(`<input id="search" />`)
		setState(searchAtom, `Layers`)
		expect($(`#search`).val()).toBe(``)
		$(`#search`).val(`Catalog`).trigger(`input`)
		expect(getState(searchAtom)).toBe(`Layers`)
	})
})
