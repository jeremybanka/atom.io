import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping"
import { parseSync } from "oxc-parser"
import { expect, it, vi } from "vitest"

import { compile } from "../src/compiler.ts"
import { hotModule, requiresModuleReload } from "../src/compiler-hmr.ts"
import spa from "../src/vite.ts"

function instrument(source: string) {
	const compiled = compile(source, `/src/View.tsx`)
	return hotModule(compiled.code, `/src/View.tsx`, compiled.map)
}

it.each([
	`export function View() { return <div/> }`,
	`export let View = () => <div/>`,
	`export var View = () => <div/>`,
	`export declare function erased(): void; export const View = () => <i/>`,
	`export /* comment */ default function View() { return <div/> }`,
	`export const View = () => <div/>`,
	`const View = () => <div/>; export { View }`,
	`function View() { return <div/> }; export { View as Renamed }`,
	`export default function View() { return <div/> }`,
	`export default function () { return <div/> }`,
	`export default () => <div/>`,
	`export default (function Named() { return <div/> })`,
	`const View = () => <div/>; export default View`,
	`export const First = () => <i/>, Second = () => <b/>`,
	`export function View() { return <i/> }; export { View as Other }; export default View`,
	`import type { Component } from '@atom.io/spa'; export interface Props { name: string }; export type Alias = Props; export const View = (props: Props) => <p>{props.name}</p>`,
	`interface Props {}; type Local = Props; declare function ignored(): void; function View() { return <i/> }; export { type Props, View }`,
	`export type { Thing } from './types'; export type * from './types'; export function View() { return <i/> }`,
	`const label = 'hello', empty = [,1]; const View = () => <i>{label}</i>; export { View as 'my view' }`,
	`#!/usr/bin/env node\n'use client'; const __spaHotRegister = 1; export /* comment */ default (() => <p>{__spaHotRegister}</p>)`,
])(`self-accepts component-only exports with stable bindings: %s`, (source) => {
	const output = instrument(source)!
	expect(output).toBeDefined()
	expect(output.code).toContain(`import.meta.hot.accept`)
	expect(output.code).toContain(`@atom.io/spa/hot`)
	expect(parseSync(`hot.tsx`, output.code, { lang: `tsx` }).errors).toEqual([])
	expect(output.exports.length).toBeGreaterThan(0)
})

it.each([
	`const View = () => <div/>`,
	`export const value = 3; export function View() { return <div/> }`,
	`export function helper() { return 1 }`,
	`export { View } from './other'`,
	`export * from './other'`,
	`import { View } from './other'; View.spa = true; export { View }`,
	`export default 1`,
	`export default <div/>`,
	`export default class View {}`,
	`export class Utility {}; export const View = () => <div/>`,
	`export enum Kind { A }; export const View = () => <div/>`,
	`const value = makeValue(); export const View = () => <div/>`,
	`const value = new Something(); export const View = () => <div/>`,
	`const styles = css\`hello\`; export const View = () => <div/>`,
	`sideEffect(); export const View = () => <div/>`,
	`let value; value = 1; export const View = () => <div/>`,
	`const object = {}; object.x = true; export const View = () => <div/>`,
	`const object = {}; object['spa'] = true; export const View = () => <div/>`,
	`const object = {}; object.spa = false; export const View = () => <div/>`,
	`export const { View } = components`,
	`import { atom as state } from 'atom.io'; const value = state({ key: 'value', default: 0 }); export const View = () => <div/>`,
	`import * as state from 'atom.io'; state.atom({ key: 'value', default: 0 }); export const View = () => <div/>`,
	`import { Silo as Store } from 'atom.io'; const store = new Store(); export const View = () => <div/>`,
])(`falls back for unsafe or mixed module exports: %s`, (source) => {
	expect(instrument(source)).toBeUndefined()
})

it(`reloads plain modules with state definitions or runtime exports`, () => {
	expect(
		requiresModuleReload(
			`import { atom as createState } from 'atom.io'; const token = createState({key:'x',default:0})`,
			`state.ts`,
		),
	).toBe(true)
	expect(
		requiresModuleReload(
			`import * as IO from 'atom.io'; IO.selector({key:'x',get:()=>0})`,
			`state.ts`,
		),
	).toBe(true)
	expect(
		requiresModuleReload(
			`const value = getState(token); value?.toString()`,
			`read.ts`,
		),
	).toBe(false)
	for (const source of [
		`export const value = 1`,
		`export default 1`,
		`export * from './other'`,
		`const value = 1; export { value }`,
	])
		expect(requiresModuleReload(source, `plain.ts`)).toBe(true)
	for (const source of [
		`export interface Props {}`,
		`export type { Props } from './types'`,
		`export type * from './types'`,
		`export declare function erased(): void`,
		`interface Props {}; export { type Props }`,
		`export {}`,
	])
		expect(requiresModuleReload(source, `types.ts`)).toBe(false)
})

it(`composes HMR sourcemaps back to authored JSX locations`, () => {
	const source = `export function View() {\n  return <button onClick={() => console.log('edit')}>hello</button>\n}`
	const output = instrument(source)!
	const index = output.code.indexOf(`console.log`)
	const prefix = output.code.slice(0, index).split(`\n`)
	const position = originalPositionFor(new TraceMap(output.map), {
		line: prefix.length,
		column: prefix.at(-1)!.length,
	})
	expect(position.line).toBe(2)
	expect(position.column).toBe(source.split(`\n`)[1].indexOf(`console.log`))
	expect(position.source).toBe(`/src/View.tsx`)
})

it(`lets Vite self-accept safe client edits while reloading state or changed export boundaries`, async () => {
	const plugin = spa()
	const configure = plugin.configResolved as Function,
		transform = plugin.transform as Function,
		update = plugin.handleHotUpdate as Function
	configure({ command: `serve`, mode: `development` })
	const source = `export default function View() { return <p>before</p> }`
	expect(transform(source, `/src/View.tsx?client`).code).toContain(
		`import.meta.hot.accept`,
	)
	expect(transform(source, `/src/View.tsx?one`).code).toContain(
		`"/src/View.tsx?one"`,
	)
	expect(transform(source, `/src/View.tsx?two`).code).toContain(
		`"/src/View.tsx?two"`,
	)
	expect(
		transform(`export default "raw source"`, `/src/View.tsx?raw`).code,
	).not.toContain(`import.meta.hot.accept`)
	expect(transform(source, `/src/View.tsx`, { ssr: true }).code).not.toContain(
		`import.meta.hot.accept`,
	)
	const send = vi.fn()
	const context = (file: string, code: string) => ({
		file,
		server: { ws: { send } },
		read: () => Promise.resolve(code),
	})
	expect(
		await update(context(`/src/View.tsx`, source.replace(`before`, `after`))),
	).toBeUndefined()
	expect(send).not.toHaveBeenCalled()
	expect(
		await update(context(`/src/View.tsx`, `${source}; export const value = 1`)),
	).toEqual([])
	expect(send).toHaveBeenLastCalledWith({ type: `full-reload` })
	transform(`${source}; export const value = 1`, `/src/View.tsx`)
	expect(await update(context(`/src/View.tsx`, source))).toEqual([])
	await update(
		context(
			`/src/state.ts`,
			`import {atom} from 'atom.io'; atom({key:'x',default:0})`,
		),
	)
	expect(send).toHaveBeenLastCalledWith({ type: `full-reload` })
	send.mockClear()
	expect(
		await update(context(`/node_modules/state.ts`, `atom({})`)),
	).toBeUndefined()
	expect(await update(context(`/src/styles.css`, ``))).toBeUndefined()
	expect(
		await update(context(`/src/view.ts`, `const value = 1`)),
	).toBeUndefined()
	expect(send).not.toHaveBeenCalled()
	await update(context(`/src/View.tsx`, `export default () => <`))
	expect(send.mock.lastCall![0].type).toBe(`error`)
	await update({
		...context(`/src/View.tsx`, source),
		read: vi.fn().mockRejectedValue(`unavailable file`),
	})
	expect(send.mock.lastCall![0].err.stack).toBe(``)
	const noStack = new Error(`unavailable file`)
	delete noStack.stack
	await update({
		...context(`/src/View.tsx`, source),
		read: vi.fn().mockRejectedValue(noStack),
	})
	expect(send.mock.lastCall![0].err.stack).toBe(``)
	configure({ command: `build`, mode: `production` })
	expect(transform(source, `/src/View.tsx`).code).not.toContain(
		`@atom.io/spa/hot`,
	)
	configure({ command: `serve`, mode: `test` })
	expect(transform(source, `/src/View.tsx`).code).not.toContain(
		`@atom.io/spa/hot`,
	)
})
