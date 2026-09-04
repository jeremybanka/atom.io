import * as v from "vitest"

import * as canonical from "../../src/foundations/canonical/index.ts"

const { packCanonical, unpackCanonical } = canonical

const number10 = 1234567890
const string26 = `abcdefghijklmnopqrstuvwxyz`
const boolean = true
const nullValue = null
const array0: never[] = []
const array10 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]
// const array100 = [...Array(100).map((_,i) => i)]

v.describe(`number10`, () => {
	const number10stringified = JSON.stringify(number10)
	const number10packed = packCanonical(number10)
	v.test(`stringify`, async ({ bench }) => {
		await bench.compare(
			bench(`JSON.stringify`, () => {
				JSON.stringify(number10)
			}),
			bench(`µ.packCanonical`, () => {
				packCanonical(number10)
			}),
		)
	})
	v.test(`parse`, async ({ bench }) => {
		await bench.compare(
			bench(`JSON.parse`, () => {
				JSON.parse(number10stringified)
			}),
			bench(`µ.unpackCanonical`, () => {
				unpackCanonical(number10packed)
			}),
		)
	})
})

v.describe(`string26`, () => {
	const string26stringified = JSON.stringify(string26)
	const string26packed = packCanonical(string26)
	v.test(`stringify`, async ({ bench }) => {
		await bench.compare(
			bench(`JSON.stringify`, () => {
				JSON.stringify(string26)
			}),
			bench(`µ.packCanonical`, () => {
				packCanonical(string26)
			}),
		)
	})
	v.test(`parse`, async ({ bench }) => {
		await bench.compare(
			bench(`JSON.parse`, () => {
				JSON.parse(string26stringified)
			}),
			bench(`µ.unpackCanonical`, () => {
				unpackCanonical(string26packed)
			}),
		)
	})
})

v.describe(`boolean`, () => {
	const booleanStringified = JSON.stringify(boolean)
	const booleanPacked = packCanonical(boolean)
	v.test(`stringify`, async ({ bench }) => {
		await bench.compare(
			bench(`JSON.stringify`, () => {
				JSON.stringify(boolean)
			}),
			bench(`µ.packCanonical`, () => {
				packCanonical(boolean)
			}),
		)
	})
	v.test(`parse`, async ({ bench }) => {
		await bench.compare(
			bench(`JSON.parse`, () => {
				JSON.parse(booleanStringified)
			}),
			bench(`µ.unpackCanonical`, () => {
				unpackCanonical(booleanPacked)
			}),
		)
	})
})

v.describe(`nullValue`, () => {
	const nullValueStringified = JSON.stringify(nullValue)
	const nullValuePacked = packCanonical(nullValue)
	v.test(`stringify`, async ({ bench }) => {
		await bench.compare(
			bench(`JSON.stringify`, () => {
				JSON.stringify(nullValue)
			}),
			bench(`µ.packCanonical`, () => {
				packCanonical(nullValue)
			}),
		)
	})
	v.test(`parse`, async ({ bench }) => {
		await bench.compare(
			bench(`JSON.parse`, () => {
				JSON.parse(nullValueStringified)
			}),
			bench(`µ.unpackCanonical`, () => {
				unpackCanonical(nullValuePacked)
			}),
		)
	})
})

v.describe(`array0`, () => {
	const array0Stringified = JSON.stringify(array0)
	const array0Packed = packCanonical(array0)
	v.test(`stringify`, async ({ bench }) => {
		await bench.compare(
			bench(`JSON.stringify`, () => {
				JSON.stringify(array0)
			}),
			bench(`µ.packCanonical`, () => {
				packCanonical(array0)
			}),
		)
	})
	v.test(`parse`, async ({ bench }) => {
		await bench.compare(
			bench(`JSON.parse`, () => {
				JSON.parse(array0Stringified)
			}),
			bench(`µ.unpackCanonical`, () => {
				unpackCanonical(array0Packed)
			}),
		)
	})
})

v.describe(`array10`, () => {
	const array10Stringified = JSON.stringify(array10)
	const array10Packed = packCanonical(array10)
	v.test(`stringify`, async ({ bench }) => {
		await bench.compare(
			bench(`JSON.stringify`, () => {
				JSON.stringify(array10)
			}),
			bench(`µ.packCanonical`, () => {
				packCanonical(array10)
			}),
		)
	})
	v.test(`parse`, async ({ bench }) => {
		await bench.compare(
			bench(`JSON.parse`, () => {
				JSON.parse(array10Stringified)
			}),
			bench(`µ.unpackCanonical`, () => {
				unpackCanonical(array10Packed)
			}),
		)
	})
})
