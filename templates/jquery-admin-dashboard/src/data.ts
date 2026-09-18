export const PLANS = { Starter: 49, Growth: 149, Scale: 399 } as const
export type Plan = keyof typeof PLANS
export type Status = `active` | `trial` | `paused`
export type Customer = {
	id: string
	name: string
	email: string
	company: string
	plan: Plan
	status: Status
}

export const INITIAL_CUSTOMERS: Customer[] = [
	{
		id: `c1`,
		name: `Olivia Rhye`,
		email: `olivia@example.com`,
		company: `Layers`,
		plan: `Scale`,
		status: `active`,
	},
	{
		id: `c2`,
		name: `Phoenix Baker`,
		email: `phoenix@example.com`,
		company: `Sisyphus`,
		plan: `Growth`,
		status: `active`,
	},
	{
		id: `c3`,
		name: `Lana Steiner`,
		email: `lana@example.com`,
		company: `Catalog`,
		plan: `Growth`,
		status: `trial`,
	},
	{
		id: `c4`,
		name: `Demi Wilkinson`,
		email: `demi@example.com`,
		company: `Circooles`,
		plan: `Starter`,
		status: `active`,
	},
	{
		id: `c5`,
		name: `Drew Cano`,
		email: `drew@example.com`,
		company: `Hourglass`,
		plan: `Scale`,
		status: `active`,
	},
	{
		id: `c6`,
		name: `Natali Craig`,
		email: `natali@example.com`,
		company: `Command+R`,
		plan: `Growth`,
		status: `paused`,
	},
	{
		id: `c7`,
		name: `Orlando Diggs`,
		email: `orlando@example.com`,
		company: `Quotient`,
		plan: `Growth`,
		status: `active`,
	},
	{
		id: `c8`,
		name: `Andi Lane`,
		email: `andi@example.com`,
		company: `Goodwell`,
		plan: `Starter`,
		status: `trial`,
	},
	{
		id: `c9`,
		name: `Kate Morrison`,
		email: `kate@example.com`,
		company: `Spherule`,
		plan: `Scale`,
		status: `active`,
	},
	{
		id: `c10`,
		name: `Kelly Williams`,
		email: `kelly@example.com`,
		company: `FocalPoint`,
		plan: `Starter`,
		status: `paused`,
	},
]

export function isStatus(value: unknown): value is Status {
	return value === `active` || value === `trial` || value === `paused`
}

export function isPlan(value: unknown): value is Plan {
	return value === `Starter` || value === `Growth` || value === `Scale`
}
