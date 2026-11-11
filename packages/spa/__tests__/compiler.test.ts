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
	it.each([`await read()`, `[this.prefix, await read()]`])(
		`evaluates suspending async keys in their enclosing function: %s`,
		async (expression) => {
			const { make, reads } = evaluate(`
				let count = 0;
				const read = () => { count++; return 'id'; };
				const Row = (props: unknown) => props;
				export const reads = () => count;
				export async function make() { return <Row key={${expression}} />; }
			`)
			const node = await make.call({ prefix: `row` })
			const key = node.props.key
			expect(key).toEqual(expression.startsWith(`[`) ? [`row`, `id`] : `id`)
			expect(node.props.key).toBe(key)
			expect(reads()).toBe(1)
		},
	)

	it.each([`yield 'pending'`, `yield* load()`])(
		`evaluates generator keys in their enclosing function: %s`,
		(expression) => {
			const { make } = evaluate(`
				const Row = (props: unknown) => props;
				function* load() { yield 'pending'; return 'id'; }
				export function* make() { return <Row key={${expression}} />; }
			`)
			const iterator = make()
			expect(iterator.next()).toEqual({ value: `pending`, done: false })
			const result = iterator.next(`id`)
			expect(result.done).toBe(true)
			expect(result.value.props.key).toBe(`id`)
		},
	)

	it.each([
		`(async function nested() { await 1; }).name`,
		`(function* nested() { yield 1; }).name`,
		`(async () => { await 1; }).name`,
	])(`keeps keys lazy across nested function boundaries: %s`, (expression) => {
		const { make, reads } = evaluate(`
			let count = 0;
			const read = () => { count++; return 'id'; };
			const Row = (props: unknown) => props;
			export const reads = () => count;
			export const make = () => <Row key={${expression} + read()} />;
		`)
		const node = make()
		expect(reads()).toBe(0)
		expect(node.props.key.endsWith(`id`)).toBe(true)
		expect(reads()).toBe(1)
	})

	it(`preserves top-level await in module keys`, () => {
		const source = `const Row = (props: unknown) => props; export const node = <Row key={await Promise.resolve('id')} />;`
		const result = compile(source, `module.tsx`)
		expect(parseSync(`module.tsx`, result.code).errors).toEqual([])
		expect(() =>
			transformSync(result.code, { loader: `tsx`, format: `esm` }),
		).not.toThrow()
	})

	it.each([
		{ expression: `row.id`, initial: 1, updated: 2 },
		{
			expression: `[row.id, row.label]`,
			initial: [1, `first`],
			updated: [2, `next`],
		},
	])(
		`keeps ordinary key $expression in one lazy props object`,
		({ expression, initial, updated }) => {
			const { App, update } = evaluate(`
			const row = { id: 1, label: 'first' };
			const Row = (props: unknown) => props;
			export const update = () => { row.id = 2; row.label = 'next'; };
			export const App = () => <Row key={${expression}} label={row.label} />;
		`)
			const { props } = App()
			expect(Object.getOwnPropertyDescriptor(props, `key`)?.get).toBeTypeOf(
				`function`,
			)
			expect(Object.getOwnPropertyDescriptor(props, `label`)?.get).toBeTypeOf(
				`function`,
			)
			expect(props.key).toEqual(initial)
			expect(props.label).toBe(`first`)
			update()
			expect(props.key).toEqual(updated)
			expect(props.label).toBe(`next`)
		},
	)

	it(`keeps expressions and keys lazy, functions intact, and spreads live`, () => {
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
		expect(reads()).toBe(0)
		expect(node.props.key).toBe(1)
		expect(reads()).toBe(1)
		expect(node.props.onClick).toBe(handler)
		expect(node.props.title).toBe(`first`)
		expect(node.props.value).toBe(1)
		expect(node.props.children[0]()).toBe(1)
		expect(node.props.children[1]()).toBe(1)
		expect(node.props.children[2]).toBe(`fixed`)
		expect(node.props.children[3].props.children()).toBe(1)
		update()
		expect(node.props.key).toBe(2)
		expect(node.props.value).toBe(2)
		expect(node.props.title).toBe(`next`)
		expect({ ...node.props }).toMatchObject({ added: 2 })
		expect(`extra` in { ...node.props }).toBe(false)
		expect(node.props.children[0]()).toBe(2)
	})

	it(`exposes component expression children as values and preserves render callbacks`, () => {
		const { App, update, reads, callback, UI } = evaluate(`
			let value = 'first', count = 0;
			const read = () => { count++; return value; };
			export const callback = (prefix: string) => prefix + value;
			export const reads = () => count;
			export const update = () => { value = 'next'; };
			export const UI = { Label: (props: { children: string }) => props.children.toUpperCase() };
			export const App = () => <>
				<UI.Label>literal</UI.Label>
				<UI.Label>{read()}</UI.Label>
				<UI.Label children={read()} />
				<UI.Label>{read()}{value}</UI.Label>
				<UI.Label>{callback}</UI.Label>
				<UI.Label>{(prefix: string) => prefix + value}</UI.Label>
			</>;
		`)
		const nodes = App().props.children
		expect(reads()).toBe(0)
		expect(nodes[0].props.children).toBe(`literal`)
		expect(UI.Label(nodes[1].props)).toBe(`FIRST`)
		expect(nodes[2].props.children).toBe(`first`)
		expect(nodes[3].props.children).toEqual([`first`, `first`])
		expect(nodes[4].props.children).toBe(callback)
		expect(nodes[5].props.children(`inline `)).toBe(`inline first`)
		update()
		expect(UI.Label(nodes[1].props)).toBe(`NEXT`)
		expect(nodes[2].props.children).toBe(`next`)
		expect(nodes[3].props.children).toEqual([`next`, `next`])
		expect(nodes[4].props.children).toBe(callback)
		expect(nodes[4].props.children(`named `)).toBe(`named next`)
	})

	it.each([``, `{...{ title: 'label' }} key={this.value}`])(
		`preserves lexical this and lazy reads in component children: %s`,
		(attributes) => {
			const { view } = evaluate(`
			const _children = 'suffix';
			const Label = (props: { children: string }) => props.children.toUpperCase();
			export const view = {
				value: 'first',
				reads: 0,
				read() { this.reads++; return this.value; },
				render() { return <Label ${attributes}>{this.read() + _children}</Label>; },
			};
		`)
			const node = view.render()
			expect(view.reads).toBe(0)
			expect(node.type(node.props)).toBe(`FIRSTSUFFIX`)
			expect(view.reads).toBe(1)
			expect(node.props.key).toBe(attributes ? `first` : undefined)
			view.value = `next`
			expect(node.type(node.props)).toBe(`NEXTSUFFIX`)
			expect(view.reads).toBe(2)
			expect(node.props.key).toBe(attributes ? `next` : undefined)
		},
	)

	it(`preserves constructor context in mixed component children`, () => {
		const { View } = evaluate(`
			const Label = (props: unknown) => props;
			class Base { label() { return 'base'; } }
			export class View extends Base {
				value: string;
				node: unknown;
				constructor(value: string) {
					super();
					this.value = value;
					this.node = <Label>{this.value}{arguments[0]}{new.target.name}{super.label()}{() => this.value}{<span>{this.value}</span>}</Label>;
				}
			}
		`)
		const view = new View(`first`)
		const children = view.node.props.children
		expect(children.slice(0, 4)).toEqual([`first`, `first`, `View`, `base`])
		view.value = `next`
		expect(children[4]()).toBe(`next`)
		expect(children[5].props.children()).toBe(`next`)
		expect(view.node.props.children.slice(0, 4)).toEqual([
			`next`,
			`first`,
			`View`,
			`base`,
		])
	})

	it.each([
		{ expression: `this.value`, initial: `first`, updated: `next` },
		{ expression: `arguments[0]`, initial: `first`, updated: `first` },
		{ expression: `new.target.name`, initial: `View`, updated: `View` },
		{ expression: `super.label()`, initial: `base`, updated: `base` },
		{ expression: `(() => this.value)()`, initial: `first`, updated: `next` },
		{
			expression: `[, this.value]`,
			initial: [, `first`],
			updated: [, `next`],
		},
		{
			expression: `eval("this.value + arguments[0]")`,
			initial: `firstfirst`,
			updated: `nextfirst`,
		},
	])(
		`preserves lexical context in lazy key $expression`,
		({ expression, initial, updated }) => {
			const { View } = evaluate(`
			const Label = (props: unknown) => props;
			class Base { label() { return 'base'; } }
			export class View extends Base {
				value: string;
				node: unknown;
				constructor(value: string) {
					super();
					this.value = value;
					this.node = <Label key={${expression}} label="row" />;
				}
			}
		`)
			const view = new View(`first`)
			expect(view.node.props.key).toEqual(initial)
			view.value = `next`
			expect(view.node.props.key).toEqual(updated)
		},
	)

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
