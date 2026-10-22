import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { highlightCode } from "./highlight-code.ts"

await test(`highlighting preserves every exhibit's source text`, () => {
	for (const packageName of [`atom.io`, `realtime`]) {
		const root = fileURLToPath(
			new URL(
				`../../../../packages/${packageName}/docs/source/exhibits/`,
				import.meta.url,
			),
		)
		for (const entry of readdirSync(root, {
			recursive: true,
			withFileTypes: true,
		})) {
			if (!entry.isFile()) continue
			const filepath = path.join(entry.parentPath, entry.name)
			const code = readFileSync(filepath, `utf8`)
			const { tokens } = highlightCode(code, entry.name.replace(/\.txt$/, ``))
			const rendered = tokens
				.map((line) => line.map((token) => token.content).join(``))
				.join(`\n`)
			assert.equal(rendered, code, filepath)
		}
	}
})

await test(`relative import strings remain distinguishable from comments`, () => {
	const { tokens } = highlightCode(
		`import { atom } from "./state.ts"\n// See "./state.ts"\n`,
		`example.ts`,
	)
	const strings = tokens.flat().filter((token) => token.type === 2)
	assert.equal(strings.length, 1)
	assert.equal(strings[0]?.content.trim(), `"./state.ts"`)
	assert.equal(strings[0]?.color, `var(--code-string-color)`)
})

await test(`empty examples and trailing blank lines survive tokenization`, () => {
	for (const code of [``, `\n\n`, `pnpm dev\n\n`]) {
		const { tokens } = highlightCode(code, `example.sh`)
		assert.equal(
			tokens
				.map((line) => line.map((token) => token.content).join(``))
				.join(`\n`),
			code,
		)
	}
})

function colorAt(
	code: string,
	text: string,
	filepath = `example.tsx`,
): string | undefined {
	const offset = code.indexOf(text)
	assert.notEqual(offset, -1)
	return highlightCode(code, filepath)
		.tokens.flat()
		.find(
			(token) =>
				token.offset <= offset && token.offset + token.content.length > offset,
		)?.color
}

await test(`generic calls retain the previous function and type palette`, () => {
	const code = `const value = api.select<Map<string, Array<number | null>>>(input)`
	assert.equal(colorAt(code, `select`), `var(--code-function-color)`)
	for (const type of [`Map`, `string`, `Array`, `number`, `null`]) {
		assert.equal(colorAt(code, type), `var(--code-type-color)`)
	}
	assert.equal(colorAt(code, `<`), `var(--code-operator-color)`)
	assert.equal(colorAt(code, `input`), `var(--code-color)`)
})

await test(`multiline function types and comments do not end generic arguments early`, () => {
	const code = `const update = transaction<\n(payload: string) => Promise<void>\n>({ default: () => {} })\nconst next = api.select /* explanation */ <number>(1)`
	assert.equal(colorAt(code, `transaction`), `var(--code-function-color)`)
	assert.equal(colorAt(code, `payload`), `var(--code-type-color)`)
	assert.equal(colorAt(code, `Promise`), `var(--code-type-color)`)
	assert.equal(colorAt(code, `select`), `var(--code-function-color)`)
	assert.equal(colorAt(code, `/* explanation */`), `var(--code-comment-color)`)
})

await test(`comparisons, shifts, JSX attributes, and literal text are not generic calls`, () => {
	const code = `const a = left < right && other > (value); const b = bits >> 2; const c = <Widget string="number">string</Widget>`
	for (const word of [`left`, `right`, `other`, `bits`]) {
		assert.equal(colorAt(code, word), `var(--code-color)`)
	}
	assert.equal(colorAt(code, `Widget`), `var(--code-type-color)`)
	assert.equal(colorAt(code, `string=`), `var(--code-color)`)
	assert.equal(colorAt(code, `"number"`), `var(--code-string-color)`)
	assert.equal(colorAt(code, `string</`), `var(--code-string-color)`)
})

await test(`strings and comments stay literal while template interpolations get generic colors`, () => {
	const code = `// atom<string>()\nconst s = "atom<string>()"; const t = \`🕊️ \${atom<number>(1)}\``
	assert.equal(colorAt(code, `// atom`), `var(--code-comment-color)`)
	assert.equal(colorAt(code, `"atom`), `var(--code-string-color)`)
	assert.equal(colorAt(code, `atom<number>`), `var(--code-function-color)`)
	assert.equal(colorAt(code, `number`), `var(--code-type-color)`)
})

await test(`constants, builtins, imports, and colons use the previous palette`, () => {
	const code = `import type { JSX } from "react"\nconst value: string = undefined; console.log(null, NaN, Infinity); const schema = z.string()`
	assert.equal(colorAt(code, `type`), `var(--code-keyword-color)`)
	assert.equal(colorAt(code, `string`), `var(--code-type-color)`)
	assert.equal(colorAt(code, `:`), `var(--code-operator-color)`)
	assert.equal(colorAt(code, `undefined`), `var(--code-keyword-color)`)
	assert.equal(colorAt(code, `null`), `var(--code-keyword-color)`)
	assert.equal(colorAt(code, `console`), `var(--code-type-color)`)
	assert.equal(colorAt(code, `NaN`), `var(--code-number-color)`)
	assert.equal(colorAt(code, `Infinity`), `var(--code-number-color)`)
	assert.equal(colorAt(`z.string()`, `string`), `var(--code-function-color)`)
})

await test(`import aliases keep keywords separate from namespace and named bindings`, () => {
	for (const filepath of [
		`example.js`,
		`example.jsx`,
		`example.ts`,
		`example.tsx`,
	]) {
		const namespace = `import * as React from "react"`
		assert.equal(colorAt(namespace, `as`, filepath), `var(--code-keyword-color)`)
		assert.equal(colorAt(namespace, `React`, filepath), `var(--code-color)`)
		const named = `import { atom as createAtom } from "atom.io"`
		assert.equal(colorAt(named, `as`, filepath), `var(--code-keyword-color)`)
		if (filepath !== `example.ts`) {
			assert.equal(
				colorAt(named, `atom`, filepath),
				`var(--code-function-color)`,
			)
			assert.equal(
				colorAt(named, `createAtom`, filepath),
				`var(--code-function-color)`,
			)
		}
	}
})

await test(`incomplete exhibits keep their source text and lexical highlighting`, () => {
	const code = `const value = atom<string>({\n\tkey: "draft",\n`
	const result = highlightCode(code, `example.ts`)
	assert.equal(
		result.tokens
			.map((line) => line.map((token) => token.content).join(``))
			.join(`\n`),
		code,
	)
	assert.equal(
		colorAt(code, `"draft"`, `example.ts`),
		`var(--code-string-color)`,
	)
})
