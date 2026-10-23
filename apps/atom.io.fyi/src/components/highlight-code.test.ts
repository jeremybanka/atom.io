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

await test(`generic calls distinguish call targets from type arguments`, () => {
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
	assert.equal(colorAt(code, `payload`), `var(--code-color)`)
	assert.equal(colorAt(code, `Promise`), `var(--code-type-color)`)
	assert.equal(colorAt(code, `select`), `var(--code-function-color)`)
	assert.equal(colorAt(code, `/* explanation */`), `var(--code-comment-color)`)
})

await test(`comparisons, shifts, JSX attributes, and literal text are not generic calls`, () => {
	const code = `const a = left < right && other > (value); const b = bits >> 2; const c = <Widget string="number">string</Widget>`
	for (const word of [`left`, `right`, `other`, `bits`]) {
		assert.equal(colorAt(code, word), `var(--code-color)`)
	}
	assert.equal(colorAt(code, `Widget`), `var(--code-function-color)`)
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

await test(`values and types have the same roles in TS and TSX`, () => {
	for (const filepath of [`example.ts`, `example.tsx`]) {
		const code = `const value: Widget = null; const flag: true = false; type Missing = null; type Text = "fixed"; type Count = 42; let result: void; void value`
		for (const text of [
			`Widget`,
			`true`,
			`Missing`,
			`Text`,
			`"fixed"`,
			`Count`,
			`42`,
			`void;`,
		])
			assert.equal(colorAt(code, text, filepath), `var(--code-type-color)`, text)
		assert.equal(colorAt(code, `null;`, filepath), `var(--code-null-color)`)
		assert.equal(colorAt(code, `false`, filepath), `var(--code-boolean-color)`)
		assert.equal(
			colorAt(code, `void value`, filepath),
			`var(--code-keyword-color)`,
		)
		assert.equal(
			colorAt(`type Missing = null`, `null`, filepath),
			`var(--code-type-color)`,
		)
	}
	for (const filepath of [
		`example.js`,
		`example.jsx`,
		`example.ts`,
		`example.tsx`,
	])
		assert.equal(
			colorAt(`const value = null`, `null`, filepath),
			`var(--code-null-color)`,
		)
})

await test(`bindings and properties do not acquire types from spelling or capitalization`, () => {
	const code = `import { settings, Promise as Deferred } from "./settings"; const obj = { string: "x", Promise: 1 }; console.log(obj.Promise, undefined, NaN, Infinity)`
	for (const filepath of [
		`example.js`,
		`example.jsx`,
		`example.ts`,
		`example.tsx`,
	]) {
		for (const word of [
			`settings`,
			`Promise`,
			`Deferred`,
			`string`,
			`console`,
			`undefined`,
			`NaN`,
			`Infinity`,
		])
			assert.equal(colorAt(code, word, filepath), `var(--code-color)`, word)
		assert.equal(colorAt(code, `as`, filepath), `var(--code-keyword-color)`)
		assert.equal(colorAt(code, `log`, filepath), `var(--code-function-color)`)
	}
})

await test(`only explicit type imports and exports get type colors`, () => {
	for (const filepath of [`example.ts`, `example.tsx`]) {
		for (const code of [
			`import type { Model as Alias } from "./model"`,
			`import { type Model as Alias, value } from "./model"`,
			`export type { Model as Alias } from "./model"`,
			`export { type Model as Alias, value } from "./model"`,
		]) {
			assert.equal(colorAt(code, `type`, filepath), `var(--code-keyword-color)`)
			assert.equal(colorAt(code, `as`, filepath), `var(--code-keyword-color)`)
			for (const name of [`Model`, `Alias`])
				assert.equal(colorAt(code, name, filepath), `var(--code-type-color)`)
			if (code.includes(`value`))
				assert.equal(colorAt(code, `value`, filepath), `var(--code-color)`)
		}
		assert.equal(
			colorAt(`import type * as React from "react"`, `React`, filepath),
			`var(--code-type-color)`,
		)
		assert.equal(
			colorAt(`import * as React from "react"`, `React`, filepath),
			`var(--code-color)`,
		)
	}
})

await test(`generic constraints preserve keywords and function type parameter names`, () => {
	const code = `function map<T extends Record<string, unknown>>(input: T): T { return input }
transaction<(payload: string) => Promise<void>>({})`
	for (const filepath of [`example.ts`, `example.tsx`]) {
		for (const word of [
			`T extends`,
			`Record`,
			`string`,
			`unknown`,
			`Promise`,
			`void`,
		])
			assert.equal(colorAt(code, word, filepath), `var(--code-type-color)`, word)
		for (const word of [`input`, `payload`])
			assert.equal(colorAt(code, word, filepath), `var(--code-color)`, word)
		assert.equal(colorAt(code, `extends`, filepath), `var(--code-keyword-color)`)
		assert.equal(colorAt(code, `return`, filepath), `var(--code-keyword-color)`)
	}
})

await test(`heritage clauses color qualified type names without coloring their keywords`, () => {
	const code = `interface Child<T> extends api.Parent<T> {}
class Implementation<T> implements api.Contract<T> {}`
	for (const filepath of [`example.ts`, `example.tsx`]) {
		for (const word of [
			`Child`,
			`T>`,
			`api.Parent`,
			`Parent`,
			`Implementation`,
			`api.Contract`,
			`Contract`,
		])
			assert.equal(colorAt(code, word, filepath), `var(--code-type-color)`, word)
		for (const word of [`interface`, `extends`, `class`, `implements`])
			assert.equal(
				colorAt(code, word, filepath),
				`var(--code-keyword-color)`,
				word,
			)
	}
})

await test(`mapped type keys retain type colors while mapping operators stay keywords`, () => {
	const code = `type Copy<T> = { [Key in keyof T]: T[Key] }`
	for (const filepath of [`example.ts`, `example.tsx`]) {
		for (const word of [`Key in`, `Key]`])
			assert.equal(colorAt(code, word, filepath), `var(--code-type-color)`, word)
		for (const word of [`in`, `keyof`])
			assert.equal(
				colorAt(code, word, filepath),
				`var(--code-keyword-color)`,
				word,
			)
	}
})

await test(`function syntax and call targets stay purple with or without annotations`, () => {
	const code = `const plain = () => {}; const typed: (payload: string) => void = () => {}; api.call(); api.optional?.(); new Factory(); function declared() {}; const object = { method() {}, callback: () => {} }; z.string()`
	for (const filepath of [`example.ts`, `example.tsx`]) {
		for (const word of [
			`plain`,
			`typed`,
			`call()`,
			`optional`,
			`Factory`,
			`declared`,
			`method`,
			`callback`,
			`string()`,
		])
			assert.equal(
				colorAt(code, word, filepath),
				`var(--code-function-color)`,
				word,
			)
		assert.equal(colorAt(code, `payload`, filepath), `var(--code-color)`)
		assert.equal(colorAt(code, `string)`, filepath), `var(--code-type-color)`)
		assert.equal(colorAt(code, `void`, filepath), `var(--code-type-color)`)
		assert.equal(colorAt(code, `api`, filepath), `var(--code-color)`)
	}
})

await test(`type queries and call wrappers distinguish value names from type names`, () => {
	const code = `type Snapshot = typeof settings; type Result = import("./model").Model; declare function declared(): void; const value = fn!(); (handler as Callback)(); type Shape = { method(payload: string): number }`
	for (const filepath of [`example.ts`, `example.tsx`]) {
		for (const word of [`settings`, `payload`])
			assert.equal(colorAt(code, word, filepath), `var(--code-color)`)
		for (const word of [
			`Snapshot`,
			`Result`,
			`Model`,
			`Callback`,
			`string`,
			`number`,
		])
			assert.equal(colorAt(code, word, filepath), `var(--code-type-color)`)
		for (const word of [`declared`, `fn`, `handler`, `method`])
			assert.equal(colorAt(code, word, filepath), `var(--code-function-color)`)
		assert.equal(colorAt(code, `typeof`, filepath), `var(--code-keyword-color)`)
	}
})

await test(`template literal types retain keyword roles inside interpolations`, () => {
	const code = `type Event<T> = \`on\${keyof T}\``
	for (const filepath of [`example.ts`, `example.tsx`]) {
		assert.equal(colorAt(code, `keyof`, filepath), `var(--code-keyword-color)`)
		assert.equal(colorAt(code, `on`, filepath), `var(--code-type-color)`)
		assert.equal(colorAt(code, `T}`, filepath), `var(--code-type-color)`)
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
