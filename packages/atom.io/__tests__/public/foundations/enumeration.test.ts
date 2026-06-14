import { enumeration } from "atom.io/foundations/enumeration"

describe(`enumeration`, () => {
	test(`creates a two-way numeric enumeration from string values`, () => {
		const change = enumeration([`add`, `delete`, `clear`] as const)

		expect(change.add).toBe(0)
		expect(change.delete).toBe(1)
		expect(change.clear).toBe(2)
		expect(change[0]).toBe(`add`)
		expect(change[1]).toBe(`delete`)
		expect(change[2]).toBe(`clear`)
	})
})
