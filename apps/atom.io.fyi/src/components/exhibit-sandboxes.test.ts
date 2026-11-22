import assert from "node:assert/strict"
import { resolve } from "node:path"
import { test } from "node:test"

import { findExhibitSandboxes } from "../../scripts/exhibit-sandboxes.ts"

await test(`discovers browser exhibits through their runtime imports`, () => {
	const examples = {
		"atom.ts": `import { atom } from 'atom.io'; export const count = atom({ key: 'count', default: 0 });`,
		"read.ts": `import { count } from './atom'; import type { Server } from 'node:http'; console.log(count);`,
		"server.ts": `import './atom.ts'; import 'node:http';`,
		"indirect-server.ts": `export * from './server.ts';`,
		"broken.ts": `import 'atom.io'; import './missing.ts';`,
		"incomplete.ts": `import 'atom.io'; let count =`,
		"plain.ts": `console.log('example');`,
		"install.sh": `pnpm add atom.io`,
	}
	const files = Object.entries(examples).map(([source, code]) => ({
		source,
		code,
		file: resolve(source),
	}))
	assert.deepEqual(
		findExhibitSandboxes(files).map(({ source }) => source),
		[`atom.ts`, `read.ts`],
	)
})
