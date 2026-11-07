import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

import { resumable } from "resumability"
import resumability, { resumablePlugin } from "resumability/astro"
import { createResumption, resumable as client } from "resumability/client"
import {
	collect,
	createCollection,
	currentCollection,
	serialize,
} from "resumability/server"

const options = {
	key: [`plain`, 1],
	server: () => ({ value: 7 }),
	client: () => ({ value: 8 }),
}
const { payload } = await collect(() => resumable(options))
const scope = createResumption(JSON.parse(serialize(payload)))
assert.deepEqual(
	scope.run(() => client(options)),
	{ value: 7 },
)
assert.deepEqual(
	scope.run(() => client(options)),
	{ value: 8 },
)
scope.add(payload)
assert.deepEqual(
	scope.run(() => client(options)),
	{ value: 8 },
)
const fresh = createResumption(payload)
assert.deepEqual(
	fresh.run(() => client(options), { resume: false }),
	{ value: 8 },
)
fresh.dispose()
scope.dispose()
assert.throws(() => client(options, scope))
assert.equal(resumability().name, `resumability`)
assert.equal(resumablePlugin().enforce, `pre`)
const wrapper = await readFile(
	new URL(import.meta.resolve(`resumability/Resumption.astro`)),
	`utf8`,
)
assert.match(wrapper, /data-resumable/)
const manifest = JSON.parse(
	await readFile(
		new URL(import.meta.resolve(`resumability/package.json`)),
		`utf8`,
	),
)
assert.deepEqual(Object.keys(manifest.peerDependencies), [`astro`])
assert.deepEqual(Object.keys(manifest.dependencies), [`@babel/core`])

const owner = createCollection()
assert.equal(currentCollection(), undefined)
const first = await owner.collect(() => resumable(options), { drain: false })
const second = await owner.collect(() => {
	assert.equal(currentCollection(), owner)
	return resumable(options)
})
assert.deepEqual(second, first)
owner.dispose()
assert.deepEqual(owner.snapshot(), first.payload)
assert.throws(() => owner.run(() => 0))
process.stdout.write(
	`Packed exports and transport passed without atom.io or SPA.\n`,
)
