import { packCanonical, unpackCanonical } from "atom.io/foundations/canonical"

describe(`packCanonical and unpackCanonical round-trip canonical values`, () => {
	const number10 = 1234567890
	const string26 = `abcdefghijklmnopqrstuvwxyz`
	const boolean = true
	const nullValue = null
	const array0: never[] = []
	const array10 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]
	const notNull = `null`
	const notOne = `1`
	const notTrue = `true`
	for (const value of [
		number10,
		string26,
		boolean,
		nullValue,
		array0,
		array10,
		notNull,
		notOne,
		notTrue,
	]) {
		test(`packValue(${JSON.stringify(value)})`, () => {
			expect(unpackCanonical(packCanonical(value))).toEqual(value)
		})
	}
})
