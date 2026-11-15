import { glob, readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL(`../`, import.meta.url))
const shards = JSON.parse(
	await readFile(new URL(`../test-shards.json`, import.meta.url), `utf8`),
) as Record<string, string[]>
for (const name of [`core`, `socket`, `runtime`]) {
	if (!Array.isArray(shards[name]) || shards[name].length === 0)
		throw new Error(`Required shard is missing or empty: ${name}`)
}
const files = new Set<string>()
for await (const file of glob(`__tests__/**/*.test.{ts,tsx}`, { cwd: root }))
	files.add(file)
const owners = new Map<string, string>()
for (const [shard, entries] of Object.entries(shards)) {
	if (![`core`, `socket`, `runtime`].includes(shard))
		throw new Error(`Unknown shard: ${shard}`)
	for (const file of entries) {
		if (!files.has(file)) throw new Error(`Missing test in ${shard}: ${file}`)
		if (owners.has(file)) throw new Error(`Duplicate ownership: ${file}`)
		if (shard === `core`) {
			const source = await readFile(
				new URL(`../${file}`, import.meta.url),
				`utf8`,
			)
			// Default harnesses bind real sockets. Keep these mixed suites out of Core.
			if (
				/\b(?:headless|singleClient|multiClient|createSocketIOTransportAdapter)\s*\(/.test(
					source,
				) ||
				/^import(?! type)[^;]*?from ["`]node:(?:child_process|worker_threads|sqlite|net)["`]/m.test(
					source,
				)
			) {
				throw new Error(`Live runtime boundary assigned to core: ${file}`)
			}
		}
		owners.set(file, shard)
	}
}
for (const file of files)
	if (!owners.has(file))
		throw new Error(`Assign new test to test-shards.json: ${file}`)
console.log(
	`Verified ${files.size} realtime tests have exactly one explicit shard owner.`,
)
