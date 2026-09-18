import { atom, selector, timeline, transaction } from "atom.io"

import type { Customer, Plan, Status } from "./data.ts"
import { INITIAL_CUSTOMERS, PLANS } from "./data.ts"

export type Filter = `all` | Status
export type Sort = `name` | `company` | `revenue`
export type Metrics = {
	total: number
	active: number
	trial: number
	mrr: number
	byPlan: Record<Plan, number>
}

export const customersAtom = atom<Customer[]>({
	key: `customers`,
	default: INITIAL_CUSTOMERS,
})
export const searchAtom = atom<string>({ key: `search`, default: `` })
export const filterAtom = atom<Filter>({ key: `filter`, default: `all` })
export const sortAtom = atom<Sort>({ key: `sort`, default: `name` })
export const selectedIdsAtom = atom<string[]>({
	key: `selectedIds`,
	default: [],
})

export const visibleCustomersSelector = selector<Customer[]>({
	key: `visibleCustomers`,
	get: ({ get }) => {
		const query = get(searchAtom).trim().toLowerCase()
		const status = get(filterAtom)
		const sort = get(sortAtom)
		return get(customersAtom)
			.filter(
				(customer) =>
					(status === `all` || customer.status === status) &&
					`${customer.name} ${customer.email} ${customer.company}`
						.toLowerCase()
						.includes(query),
			)
			.sort((a, b) =>
				sort === `revenue`
					? (b.status === `active` ? PLANS[b.plan] : 0) -
							(a.status === `active` ? PLANS[a.plan] : 0) ||
						a.name.localeCompare(b.name)
					: a[sort].localeCompare(b[sort]),
			)
	},
})

// Overview totals describe the whole workspace, independently of table filters.
export const metricsSelector = selector<Metrics>({
	key: `metrics`,
	get: ({ get }) => {
		const customers = get(customersAtom)
		const active = customers.filter((customer) => customer.status === `active`)
		const byPlan: Record<Plan, number> = { Starter: 0, Growth: 0, Scale: 0 }
		for (const customer of active) byPlan[customer.plan] += PLANS[customer.plan]
		return {
			total: customers.length,
			active: active.length,
			trial: customers.filter((customer) => customer.status === `trial`).length,
			mrr: Object.values(byPlan).reduce((sum, revenue) => sum + revenue, 0),
			byPlan,
		}
	},
})

// Search and selection are UI state; only customer edits belong in undo history.
export const customersTimeline = timeline({
	key: `customers`,
	scope: [customersAtom],
})

export const filterCustomersTransaction = transaction<
	(query: string, filter: Filter) => void
>({
	key: `filterCustomers`,
	do: ({ set }, query, filter) => {
		set(searchAtom, query)
		set(filterAtom, filter)
		set(selectedIdsAtom, [])
	},
})

export const updateStatusTransaction = transaction<
	(ids: readonly string[], status: Status) => void
>({
	key: `updateStatus`,
	do: ({ get, set }, ids, status) => {
		const customers = get(customersAtom)
		if (
			customers.some(
				(customer) => ids.includes(customer.id) && customer.status !== status,
			)
		) {
			set(
				customersAtom,
				customers.map((customer) =>
					ids.includes(customer.id) ? { ...customer, status } : customer,
				),
			)
		}
		set(selectedIdsAtom, [])
	},
})

export const addCustomerTransaction = transaction<
	(customer: Customer) => string | null
>({
	key: `addCustomer`,
	do: ({ get, set }, customer) => {
		const customers = get(customersAtom)
		const normalized = {
			...customer,
			name: customer.name.trim(),
			company: customer.company.trim(),
			email: customer.email.trim().toLowerCase(),
		}
		if (
			!normalized.name ||
			!normalized.company ||
			!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.email)
		) {
			return `Enter a name, company, and valid email address.`
		}
		if (
			customers.some(
				(existing) =>
					existing.email.toLowerCase() === normalized.email ||
					existing.id === normalized.id,
			)
		) {
			return `A customer with this email already exists.`
		}
		set(customersAtom, [...customers, normalized])
		set(searchAtom, ``)
		set(filterAtom, `all`)
		set(selectedIdsAtom, [])
		return null
	},
})
