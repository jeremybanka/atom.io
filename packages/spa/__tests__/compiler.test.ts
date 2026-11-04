// @vitest-environment node

import { runInNewContext } from "node:vm"

import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping"
import { transformSync } from "esbuild"
import { parseSync } from "oxc-parser"
import { describe, expect, it } from "vitest"

import { compile } from "../src/compiler.ts"
import { jsx, merge } from "../src/jsx-runtime.ts"

function evaluate(source: string): Record<string, any> {
	const compiled = compile(source, `fixture.tsx`)
	expect(parseSync(`fixture.tsx`, compiled.code).errors).toEqual([])
	const { code } = transformSync(compiled.code, { loader: `tsx`, format: `cjs` })
	const module = { exports: {} }
	runInNewContext(
		code.replace(/^#![^\n]*\n/, ``),
		{
			require: (name: string) => {
				expect(name).toBe(`@atom.io/spa/jsx-runtime`)
				return { jsx, merge }
			},
			module,
			exports: module.exports,
		},
		{ filename: `fixture.cjs` },
	)
	return module.exports
}

describe(`Oxc JSX compiler`, () => {
	it(`keeps expressions lazy, functions intact, keys eager, and spreads live`, () => {
		const { App, update, reads, handler } = evaluate(`
			let value = 1, count = 0;
			let spread = { title: 'first', extra: 1 };
			const read = () => { count++; return value; };
			export const handler = () => read();
			export const reads = () => count;
			export const update = () => { value = 2; spread = { title: 'next', added: 2 }; };
			export const App = () => <div title="before" {...spread} key={read()} value={read()} onClick={handler}>
				{read()}{() => read()}{'fixed'}{<span>{read()}</span>}
			</div>;
		`)
		const node = App()
		expect(reads()).toBe(1)
		expect(node.props.key).toBe(1)
		expect(node.props.onClick).toBe(handler)
		expect(node.props.title).toBe(`first`)
		expect(node.props.value).toBe(1)
		expect(node.props.children[0]()).toBe(1)
		expect(node.props.children[1]()).toBe(1)
		expect(node.props.children[2]).toBe(`fixed`)
		expect(node.props.children[3].props.children()).toBe(1)
		update()
		expect(node.props.key).toBe(1)
		expect(node.props.value).toBe(2)
		expect(node.props.title).toBe(`next`)
		expect({ ...node.props }).toMatchObject({ added: 2 })
		expect(`extra` in { ...node.props }).toBe(false)
		expect(node.props.children[0]()).toBe(2)
	})

	it(`keeps motion exit props and conditional keyed children live`, () => {
		const { App, update } = evaluate(`
   let visible = true, distance = 10, spread = { 'motion:exit': { x: -1 } };
   export const update = () => { visible = false; distance = 20; spread = { 'motion:exit': { x: -2 } }; };
   export const App = () => <>{visible && <custom-panel key="panel" {...spread} motion:exit={{ x: -distance }} />}</>;
  `)
		const parent = App(),
			child = parent.props.children()
		expect(child.props.key).toBe(`panel`)
		expect(child.props[`motion:exit`]).toEqual({ x: -10 })
		update()
		expect(parent.props.children()).toBe(false)
		expect(child.props[`motion:exit`]).toEqual({ x: -20 })
	})

	it(`handles nested JSX, generic components, fragments, and member tags`, () => {
		const { App, UI } = evaluate(`
			export const UI = { Item: (props: unknown) => props };
			const Component = <T,>(props: T) => props;
			export function App() {
				return <><UI.Item slot={<span/>}/><Component<number> value={1}/>
					{[1, 2].map(n => <svg:path data-n={n}/>)}<custom-element/>
				</>;
			}
		`)
		const node = App()
		expect(App.spa).toBe(true)
		expect(node.type).toBe(null)
		expect(node.props.children[0].type).toBe(UI.Item)
		expect(node.props.children[0].props.slot.type).toBe(`span`)
		expect(node.props.children[1].props.value).toBe(1)
		expect(node.props.children[2]().map((child: any) => child.type)).toEqual([
			`svg:path`,
			`svg:path`,
		])
		expect(node.props.children[3].type).toBe(`custom-element`)
	})

	it(`defers JSX-valued props even through parentheses`, () => {
		const { App, reads } = evaluate(`
			let count = 0;
			const read = () => ++count;
			export const reads = () => count;
			export const App = () => <div slot={(<span key={read()}/>)} />;
		`)
		const node = App()
		expect(reads()).toBe(0)
		expect(node.props.slot.props.key).toBe(1)
		expect(node.props.slot.props.key).toBe(2)
	})

	it(`supports JSX-valued attributes without an expression container`, () => {
		const { App } = evaluate(`export const App = () => <div slot=<span/> />`)
		expect(App().props.slot.type).toBe(`span`)
	})

	it(`preserves holes in lazy array expressions`, () => {
		const { App } = evaluate(`export const App = () => <div>{[,,1]}</div>`)
		const children = App().props.children()
		expect(children).toHaveLength(3)
		expect(0 in children).toBe(false)
		expect(children[2]).toBe(1)
	})

	it(`decodes JSX entities and normalizes multiline text without changing expression strings`, () => {
		const { App } = evaluate(`
			export const App = () => <div title="&quot; &#x1f600; &nbsp; &amp; &unknown;">
				Hello &amp;
				world&#33;
				<span /> tail {'&amp;'}
			</div>;
		`)
		const node = App()
		expect(node.props.title).toBe(`" 😀 \u00a0 & &unknown;`)
		expect(node.props.children[0]).toBe(`Hello & world!`)
		expect(node.props.children[2]).toBe(` tail `)
		expect(node.props.children[3]).toBe(`&amp;`)
	})

	it.each([
		`() => <p/>`,
		`(() => <p/>)`,
		`function () { return <p/> }`,
		`(function () { return <p/> })`,
		`function Named() { return <p/> }`,
		`async function () { return <p/> }`,
		`function /* function (*) */ * () { yield <p/> }`,
	])(`brands default exports: %s`, (component) => {
		const module = evaluate(`export default ${component}`)
		expect(module[`default`].spa).toBe(true)
	})

	it.each([
		`export /* export default */ default /* @__PURE__ */ (() => <p/>)`,
		`export // export comment\n default // annotation\n (() => <p/>)`,
	])(`preserves default-export comments: %s`, (source) => {
		const original = parseSync(`comments.tsx`, source).comments
		const result = compile(source, `comments.tsx`)
		const rewritten = parseSync(`comments.tsx`, result.code)
		expect(rewritten.errors).toEqual([])
		expect(rewritten.comments.map((comment) => comment.value)).toEqual(
			original.map((comment) => comment.value),
		)
		const module = evaluate(source)
		expect(module[`default`].spa).toBe(true)
		expect(module[`default`]().type).toBe(`p`)
	})

	it(`keeps anonymous default function declarations hoisted`, () => {
		const result = compile(
			`export default async /* function */ function () { return <p/> }`,
			`hoisted.tsx`,
		)
		const declaration = parseSync(`hoisted.tsx`, result.code).program.body.find(
			(node) => node.type === `ExportDefaultDeclaration`,
		)
		expect(
			declaration?.type === `ExportDefaultDeclaration` &&
				declaration.declaration.type,
		).toBe(`FunctionDeclaration`)
	})

	it(`avoids authored helper names and preserves directives, hashbangs, and Unicode offsets`, () => {
		const source = `#!/usr/bin/env node\n"use client";\nconst _spa = '😀', _props = 2, _Component = 3;\nexport default () => <p title={_spa}>{_props + _Component}</p>;`
		const result = compile(source, `unicode.tsx`)
		expect(result.code.startsWith(`#!/usr/bin/env node\n"use client";`)).toBe(
			true,
		)
		expect(result.code).toContain(`jsx as _spa2`)
		const { default: App } = evaluate(source)
		expect(App().props.title).toBe(`😀`)
		expect(App().props.children()).toBe(5)
	})

	it(`maps preserved expressions back to their authored positions`, () => {
		const source = `const emoji = "😀";\nexport const App = () => <p title={emoji}>{emoji.toUpperCase()}</p>;`
		const result = compile(source, `mapping.tsx`)
		const prefix = result.code.slice(0, result.code.indexOf(`emoji.toUpperCase`))
		const lines = prefix.split(`\n`)
		const position = originalPositionFor(new TraceMap(result.map.toString()), {
			line: lines.length,
			column: lines.at(-1)!.length,
		})
		expect(position).toMatchObject({
			source: `mapping.tsx`,
			line: 2,
			column: source.split(`\n`)[1].indexOf(`emoji.toUpperCase`),
		})
		expect(result.map.sourcesContent).toEqual([source])
	})

	it(`preserves non-JSX modules and reports invalid JSX with its filename`, () => {
		const source = `// comment\nexport const identity = <T,>(value: T): T => value;`
		expect(compile(source, `identity.tsx`).code).toBe(source)
		expect(() => compile(`<div value={}/>`, `broken.tsx`)).toThrow(`broken.tsx`)
		expect(() => compile(`<div>`, `broken.tsx`)).toThrow(SyntaxError)
		expect(() => compile(`<div>{...children}</div>`, `spread.tsx`)).toThrow(
			`spread children`,
		)
	})
})
