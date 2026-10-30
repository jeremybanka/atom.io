import { describe, expect, it } from "vitest"

import integration, { resumablePlugin } from "../src/astro.ts"
import { compile } from "../src/compiler.ts"

const prelude = `import { resumable } from 'resumability';`
describe(`server closure boundary`, () => {
	it(`erases inline closures and their imports while retaining client code and sourcemaps`, () => {
		const result = compile(
			`${prelude} export const read = () => resumable({key: 'a', server: async () => { const db = await import('node:sqlite'); return db }, client: () => 'client' }, scope)`,
			`values.ts`,
		)
		expect(result.code).not.toContain(`node:sqlite`)
		expect(result.code).not.toContain(`server:`)
		expect(result.code).toContain(`client`)
		expect(result.map).toMatchObject({ sources: [`values.ts`] })
	})
	it(`supports named import aliases, string imports, methods, and TSX`, () => {
		for (const source of [
			`import {resumable as resume} from 'resumability'; resume({key:'x', server(){ return 'SECRET' }});`,
			`import {'resumable' as resume} from 'resumability/client'; resume({key:'x', 'server': function(){ return 'SECRET' }});`,
			`${prelude} const view = <p>{resumable({key:'x', server:()=> 'SECRET', client:()=> 'ok'})}</p>`,
		])
			expect(compile(source, `fixture.tsx`).code).not.toContain(`SECRET`)
	})
	it(`does not rewrite unrelated or shadowed functions`, () => {
		for (const source of [
			`const resumable = (o) => o; resumable({server:()=> 'KEEP'})`,
			`import {resumable} from 'unrelated'; resumable({server:()=> 'KEEP'})`,
			`import {other} from 'resumability'; other({server:()=> 'KEEP'})`,
			`${prelude} function nested(resumable) { return resumable({server:()=> 'KEEP'}) }`,
			`globalThis.resumable({server:()=> 'KEEP'}); unknown({server:()=> 'KEEP'})`,
		])
			expect(compile(source, `fixture.ts`).code).toContain(`KEEP`)
	})
	it.each([
		`resumable(options)`,
		`resumable({...options, server:()=> 1})`,
		`resumable({['server']:()=> 1})`,
		`resumable({server: producer})`,
		`resumable({get server(){ return producer }})`,
		`resumable()`,
		`const alias = resumable; alias({server:()=>1})`,
		`consume(resumable)`,
	])(`rejects ambiguous boundaries: %s`, (source) => {
		expect(() => compile(`${prelude} ${source}`, `fixture.ts`)).toThrow(
			/resumable|Call resumable/,
		)
	})
	it(`rejects namespace imports and malformed syntax`, () => {
		expect(() =>
			compile(
				`import * as r from 'resumability'; r.resumable({server:()=>1})`,
				`x.ts`,
			),
		).toThrow(`named resumable`)
		expect(() => compile(`export const =`, `x.ts`)).toThrow()
	})
	it(`runs before browser import analysis and leaves SSR and unrelated files alone`, () => {
		const plugin = resumablePlugin()
		const transform = plugin.transform as Function
		expect(plugin.enforce).toBe(`pre`)
		expect(transform(prelude, `/src/data.ts`, { ssr: true })).toBe(null)
		expect(transform(`export const a = 1`, `/src/data.ts`)).toBe(null)
		expect(transform(prelude, `/src/page.astro`)).toBe(null)
		const source = `${prelude} resumable({key:'a', server:()=>import('node:sqlite')})`
		for (const id of [
			`/src/data.ts`,
			`/src/data.jsx?x`,
			`/src/page.astro?astro&type=script&index=0&lang.ts`,
		]) {
			expect(transform(source, id, { ssr: false }).code).not.toContain(
				`node:sqlite`,
			)
		}
	})
	it(`installs just the compiler and package resolution configuration`, () => {
		let config: any
		const setup = integration().hooks[`astro:config:setup`] as Function
		setup({
			updateConfig: (next: any) => {
				config = next
			},
		})
		expect(config.vite.plugins[0].name).toBe(`resumability`)
		expect(config.vite.optimizeDeps.exclude).toContain(`resumability`)
		expect(config.vite.ssr.noExternal).toEqual([`resumability`])
	})
})
