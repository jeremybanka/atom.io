import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

import { resumable } from "@atom.io/resumable"
import integration, { resumablePlugin } from "@atom.io/resumable/astro"
import { createResumption, resumable as client } from "@atom.io/resumable/client"
import { collect, serialize } from "@atom.io/resumable/server"

const options = {
	key: [`plain`, 1],
	server: () => ({ value: 7 }),
	client: () => ({ value: 8 }),
}
const { payload } = await collect(() => resumable(options))
const scope = createResumption(JSON.parse(serialize(payload)))
assert.deepEqual(client(options, scope), { value: 7 })
assert.deepEqual(client(options, scope), { value: 8 })
scope.dispose()
assert.throws(() => client(options, scope))
assert.equal(integration().name, `@atom.io/resumable`)
assert.equal(resumablePlugin().enforce, `pre`)
const wrapper = await readFile(
	new URL(import.meta.resolve(`@atom.io/resumable/Resumption.astro`)),
	`utf8`,
)
assert.match(wrapper, /data-resumable/)
const manifest = JSON.parse(
	await readFile(
		new URL(import.meta.resolve(`@atom.io/resumable/package.json`)),
		`utf8`,
	),
)
assert.deepEqual(Object.keys(manifest.peerDependencies), [`astro`])
assert.deepEqual(Object.keys(manifest.dependencies), [`@babel/core`])
process.stdout.write(
	`Packed exports and transport passed without atom.io or SPA.\n`,
)
