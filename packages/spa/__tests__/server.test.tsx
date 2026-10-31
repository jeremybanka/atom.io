import { describe, expect, it } from "vitest"

import { hydrate } from "../src/index.ts"
import { renderToString } from "../src/server.ts"

describe(`server attribute and form semantics`, () => {
	it.each([true, false])(
		`serializes enumerated boolean values as %s`,
		(value) => {
			const setup = () => (
				<section
					draggable={value}
					spellcheck={value}
					aria-hidden={value}
					data-enabled={value}
				>
					<button disabled={value} />
				</section>
			)
			const host = document.createElement(`div`)
			host.innerHTML = renderToString(setup)
			const section = host.querySelector(`section`)!
			for (const name of [
				`draggable`,
				`spellcheck`,
				`aria-hidden`,
				`data-enabled`,
			])
				expect(section.getAttribute(name)).toBe(String(value))
			expect(host.querySelector(`button`)!.hasAttribute(`disabled`)).toBe(value)
			const root = hydrate(setup, host)
			try {
				expect(host.querySelector(`section`)).toBe(section)
				for (const name of [`aria-hidden`, `data-enabled`])
					expect(section.getAttribute(name)).toBe(String(value))
			} finally {
				root.dispose()
			}
		},
	)
	it(`preserves overloaded boolean and hidden attribute values`, () => {
		const setup = () => (
			<>
				<a download={true} />
				<a download={false} />
				<a download="file.txt" />
				<input capture={true} />
				<input capture={false} />
				<input capture="environment" />
				<div hidden={true} />
				<div hidden={false} />
				<div hidden="until-found" />
			</>
		)
		const host = document.createElement(`section`)
		host.innerHTML = renderToString(setup)
		for (const [tag, attr, string] of [
			[`a`, `download`, `file.txt`],
			[`input`, `capture`, `environment`],
			[`div`, `hidden`, `until-found`],
		]) {
			const elements = host.querySelectorAll(tag)
			expect([...elements].map((element) => element.getAttribute(attr))).toEqual(
				[``, null, string],
			)
		}
	})
	it(`renders effective form defaults before hydration and preserves them afterward`, () => {
		const setup = () => (
			<form>
				<input defaultValue={'hello <&"'} />
				<input defaultValue={0} />
				<input type="checkbox" defaultChecked />
				<input type="checkbox" defaultChecked={false} />
				<textarea defaultValue={"hello <&"} />
			</form>
		)
		const host = document.createElement(`section`)
		host.innerHTML = renderToString(setup)
		expect(host.innerHTML).not.toMatch(/defaultvalue|defaultchecked/i)
		const inputs = [...host.querySelectorAll(`input`)]
		const textarea = host.querySelector(`textarea`)!
		const check = () => {
			expect(inputs[0].value).toBe('hello <&"')
			expect(inputs[1].value).toBe(`0`)
			expect(inputs[2].checked).toBe(true)
			expect(inputs[3].checked).toBe(false)
			expect(textarea.value).toBe(`hello <&`)
		}
		check()
		const root = hydrate(setup, host)
		try {
			check()
			expect([...host.querySelectorAll(`input`)]).toEqual(inputs)
			expect(host.querySelector(`textarea`)).toBe(textarea)
		} finally {
			root.dispose()
		}
	})
	it(`gives controlled values precedence over defaults regardless of prop order`, () => {
		const setup = () => (
			<form>
				<input defaultValue="default" value="controlled" />
				<input value="controlled" defaultValue="default" />
				<input type="checkbox" defaultChecked checked={false} />
				<input type="checkbox" checked={false} defaultChecked />
				<textarea defaultValue="default" value="controlled" />
				<textarea value="controlled" defaultValue="default" />
				<textarea value={null} defaultValue="fallback" />
				<textarea defaultValue={null}>children</textarea>
			</form>
		)
		const host = document.createElement(`section`)
		host.innerHTML = renderToString(setup)
		const inputs = [...host.querySelectorAll(`input`)]
		expect(inputs.slice(0, 2).map((input) => input.value)).toEqual([
			`controlled`,
			`controlled`,
		])
		expect(inputs.slice(2).map((input) => input.checked)).toEqual([false, false])
		expect(
			[...host.querySelectorAll(`textarea`)].map((input) => input.value),
		).toEqual([`controlled`, `controlled`, `fallback`, `children`])
	})
})
