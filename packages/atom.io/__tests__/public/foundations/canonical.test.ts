import { packCanonical, unpackCanonical } from "atom.io/foundations/canonical"

describe(`canonical`, () => {
	test(`packCanonical and unpackCanonical round-trip primitive canonical values`, () => {
		expect(unpackCanonical(packCanonical(`hello`))).toBe(`hello`)
		expect(unpackCanonical(packCanonical(42))).toBe(42)
		expect(unpackCanonical(packCanonical(true))).toBe(true)
		expect(unpackCanonical(packCanonical(false))).toBe(false)
		expect(unpackCanonical(packCanonical(null))).toBeNull()
	})

	test(`packCanonical and unpackCanonical round-trip array canonical values`, () => {
		const value = [`a`, 1, false, null, [`nested`]] as const
		expect(unpackCanonical(packCanonical(value))).toEqual(value)
	})

	test(`packCanonical distinguishes values that JSON.stringify alone can conflate`, () => {
		expect(packCanonical(`null`)).not.toBe(packCanonical(null))
		expect(packCanonical(`1`)).not.toBe(packCanonical(1))
		expect(packCanonical(true)).not.toBe(packCanonical(1))
	})
})
