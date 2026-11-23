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
	const { sandboxes } = findExhibitSandboxes(files)
	assert.deepEqual(
		sandboxes.map(({ source, ecology, preview }) => [source, ecology, preview]),
		[
			[`atom.ts`, true, false],
			[`read.ts`, true, false],
		],
	)
})

await test(`offers Preview for default React functions and compiles their JSX dependencies`, () => {
	const examples = {
		"plain.tsx": `export default function Greeting() { return <p>Hello</p> }`,
		"counter.tsx": `import { useO } from '@atom.io/react'; import { Count } from './count.tsx'; const Counter = () => <Count />; export { Counter as default };`,
		"count.tsx": `import { atom } from 'atom.io'; const count = atom({ key: 'count', default: 0 }); export const Count = () => <span>{count.key}</span>;`,
		"spa.tsx": `import { useGetter } from '@atom.io/spa'; import { atom } from 'atom.io'; export default function Component() { return <p /> }`,
		"solid.tsx": `/** @jsxImportSource @solidjs/web */ export default () => <p />;`,
		"object.ts": `export default { name: 'settings' };`,
		"server.tsx": `import 'node:http'; export default () => <p />;`,
	}
	const files = Object.entries(examples).map(([source, code]) => ({
		source,
		code,
		file: resolve(source),
	}))
	const { sandboxes, reactFiles } = findExhibitSandboxes(files)
	assert.deepEqual(
		sandboxes.map(({ source, ecology, preview }) => [source, ecology, preview]),
		[
			[`plain.tsx`, false, true],
			[`counter.tsx`, true, true],
			[`count.tsx`, true, false],
			[`spa.tsx`, true, false],
		],
	)
	assert.deepEqual(
		[...reactFiles],
		[resolve(`plain.tsx`), resolve(`counter.tsx`), resolve(`count.tsx`)],
	)
})
