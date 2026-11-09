import test from "node:test"
import assert from "node:assert/strict"
import { readCapture, readSnapshot, validateId } from "./host/schema.ts"

await test("snapshot retains a server-computed value and target IDs", () => {
	assert.deepEqual(readSnapshot('{"version":1,"value":17,"text":["cart"]}'), {
		version: 1,
		value: 17,
		text: ["cart"],
	})
})
await test("unsupported state and unsafe reference formats fail closed", () => {
	for (const input of [
		"null",
		"{}",
		'{"version":2,"value":0,"text":["cart"]}',
		'{"version":1,"value":"0","text":["cart"]}',
		'{"version":1,"value":1e999,"text":["cart"]}',
		'{"version":1,"value":0,"text":[]}',
		'{"version":1,"value":0,"text":["#cart"]}',
	]) {
		assert.throws(() => readSnapshot(input))
	}
	for (const input of ["null", "{}", "[]", '["#cart"]', "[1]"])
		assert.throws(() => readCapture(input))
	assert.deepEqual(readCapture('["q4","cart"]'), ["q4", "cart"])
	for (const input of ["../x", 'a"b', "constructor.x", "", 0])
		assert.throws(() => {
			validateId(input)
		})
})
