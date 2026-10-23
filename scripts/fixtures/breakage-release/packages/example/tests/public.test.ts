import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const { value } = JSON.parse(
	readFileSync(new URL(`../value.json`, import.meta.url), `utf8`),
)
assert.equal(value, `released`)
