import { Silo } from "atom.io"
import { expect, it, vi } from "vitest"

import { dispose, owner } from "../src/core.ts"
import { onMount, render, useGetter, useSetter } from "../src/index.ts"

it(`restores rejected edits after handlers and supports per-edit change on text, textarea, and range`, () => {
	const silo = new Silo({
		name: `forms`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const textAtom = silo.atom<string>({ key: `text`, default: `abc` })
	const host = document.createElement(`main`)
	document.body.append(host)
	const edits: string[] = []
	let flush = () => {}
	function App() {
		const getText = useGetter(textAtom),
			setText = useSetter(textAtom)
		return (
			<div
				onChange={(event) => {
					edits.push(`parent:${(event.target as HTMLInputElement).value}`)
				}}
			>
				<input
					id="reject"
					value={getText()}
					onInput={(event) => {
						flush()
						edits.push(`input:${event.currentTarget.value}`)
					}}
				/>
				<input
					id="accept"
					value={getText()}
					onChange={(event) => {
						setText(event.currentTarget.value)
					}}
				/>
				<textarea
					value={getText()}
					onChange={(event) => {
						setText(event.currentTarget.value)
					}}
				/>
				<input
					type="range"
					value={1}
					onChange={(event) => {
						edits.push(`range:${event.currentTarget.value}`)
					}}
				/>
			</div>
		)
	}
	const root = render(() => <App />, host, { store: silo.store })
	flush = root.flush
	const fields = [
		...host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
			`input,textarea`,
		),
	]
	try {
		fields[0].click()
		fields[0].value = `abcd`
		fields[0].dispatchEvent(new InputEvent(`input`, { bubbles: true }))
		expect(edits).toEqual([`input:abcd`, `parent:abcd`])
		root.flush()
		expect(fields[0].value).toBe(`abc`)
		for (const field of [fields[1], fields[2]]) {
			field.value = `accepted`
			field.dispatchEvent(new InputEvent(`input`, { bubbles: true }))
			root.flush()
			expect(silo.getState(textAtom)).toBe(`accepted`)
			expect(fields[0].value).toBe(`accepted`)
		}
		const before = edits.length
		fields[1].dispatchEvent(new Event(`change`, { bubbles: true }))
		expect(edits).toHaveLength(before)
		fields[3].value = `2`
		fields[3].dispatchEvent(new InputEvent(`input`, { bubbles: true }))
		root.flush()
		expect(edits).toContain(`range:2`)
		expect(fields[3].value).toBe(`1`)
	} finally {
		root.dispose()
		host.remove()
	}
})

it(`restores rejected checkboxes and radio groups while leaving default fields uncontrolled`, async () => {
	const host = document.createElement(`main`)
	document.body.append(host)
	const changes: boolean[] = []
	const root = render(
		() => (
			<>
				<input
					type="checkbox"
					checked={false}
					onChange={(event) => {
						changes.push(event.currentTarget.checked)
					}}
				/>
				<input type="radio" name="group" checked />
				<input type="radio" name="group" checked={false} />
				<input defaultValue="seed" />
				<input type="checkbox" defaultChecked />
				<input
					type="file"
					onChange={(event) => {
						changes.push(event.currentTarget.files !== null)
					}}
				/>
			</>
		),
		host,
	)
	const fields = [...host.querySelectorAll(`input`)]
	try {
		fields[0].click()
		root.flush()
		expect(changes).toEqual([true])
		expect(fields[0].checked).toBe(false)
		fields[2].click()
		root.flush()
		expect(fields[1].checked).toBe(true)
		expect(fields[2].checked).toBe(false)
		fields[3].value = `edited`
		fields[3].dispatchEvent(new Event(`input`, { bubbles: true }))
		fields[4].click()
		root.flush()
		expect(fields[3].value).toBe(`edited`)
		expect(fields[4].checked).toBe(false)
		fields[5].dispatchEvent(new Event(`change`, { bubbles: true }))
		expect(changes).toHaveLength(2)
		await Promise.resolve()
	} finally {
		root.dispose()
		host.remove()
	}
})

it(`restores radio peers in separate roots and keeps separate names and forms independent`, async () => {
	const host = document.createElement(`main`)
	document.body.append(host)
	const a = document.createElement(`section`),
		b = document.createElement(`section`)
	host.append(a, b)
	const first = render(
		() => (
			<>
				<input type="radio" name="shared" checked />
				<input type="radio" name="other" checked />
				<form>
					<input type="radio" name="shared" checked />
				</form>
			</>
		),
		a,
	)
	const second = render(
		() => <input type="radio" name="shared" checked={false} />,
		b,
	)
	try {
		b.querySelector(`input`)!.click()
		await Promise.resolve()
		expect(
			[...host.querySelectorAll(`input`)].map((input) => input.checked),
		).toEqual([true, true, true, false])
	} finally {
		second.dispose()
		first.dispose()
		host.remove()
	}
})

it(`restores radio peers across roots when change is stopped`, async () => {
	const host = document.createElement(`main`)
	const a = document.createElement(`section`)
	const b = document.createElement(`section`)
	host.append(a, b)
	document.body.append(host)
	const first = render(() => <input type="radio" name="shared" checked />, a)
	const change = vi.fn((event: Event) => {
		event.stopPropagation()
	})
	const second = render(
		() => <input type="radio" name="shared" checked={false} onChange={change} />,
		b,
	)
	const peer = a.querySelector(`input`)!
	const clicked = b.querySelector(`input`)!
	try {
		clicked.click()
		expect(change).toHaveBeenCalledOnce()
		expect(peer.checked).toBe(false)
		expect(clicked.checked).toBe(true)
		await vi.waitFor(() => {
			expect(peer.checked).toBe(true)
			expect(clicked.checked).toBe(false)
		})
	} finally {
		second.dispose()
		first.dispose()
		host.remove()
	}
})

it(`reapplies select values after nested option insertion, replacement, and removal`, () => {
	const silo = new Silo({
		name: `select`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const optionsAtom = silo.atom<string[]>({ key: `options`, default: [] })
	const host = document.createElement(`main`)
	const changed = vi.fn()
	const root = render(
		() => {
			const getOptions = useGetter(optionsAtom)
			return (
				<select value="b" onChange={changed}>
					<optgroup>
						{getOptions().map((value) => (
							<option key={value} value={value} disabled={value === `disabled`}>
								{value}
							</option>
						))}
					</optgroup>
				</select>
			)
		},
		host,
		{ store: silo.store },
	)
	const select = host.querySelector(`select`)!
	try {
		expect(select.selectedIndex).toBe(-1)
		for (const options of [[`a`, `b`, `c`], [`c`, `b`], [`disabled`, `a`], []]) {
			silo.setState(optionsAtom, options)
			root.flush()
			expect(select.value).toBe(
				options.includes(`b`) ? `b` : options.includes(`a`) ? `a` : ``,
			)
		}
		select.dispatchEvent(new Event(`input`, { bubbles: true }))
		expect(changed).not.toHaveBeenCalled()
		select.dispatchEvent(new Event(`change`, { bubbles: true }))
		expect(changed).toHaveBeenCalledOnce()
	} finally {
		root.dispose()
	}
})

it(`keeps numerically equivalent number input strings and writes genuinely new values`, () => {
	const silo = new Silo({
		name: `number`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const numberAtom = silo.atom<number>({ key: `number`, default: 0 })
	const host = document.createElement(`main`)
	const root = render(
		() => {
			const getNumber = useGetter(numberAtom),
				setNumber = useSetter(numberAtom)
			return (
				<input
					type="number"
					value={getNumber()}
					onChange={(event) => {
						setNumber(Number(event.currentTarget.value))
					}}
				/>
			)
		},
		host,
		{ store: silo.store },
	)
	const input = host.querySelector(`input`)!
	try {
		input.value = `01`
		input.dispatchEvent(new Event(`input`, { bubbles: true }))
		root.flush()
		expect(silo.getState(numberAtom)).toBe(1)
		expect(input.value).toBe(`01`)
		silo.setState(numberAtom, 2)
		root.flush()
		expect(input.value).toBe(`2`)
		input.value = ``
		root.flush()
		expect(input.value).toBe(`2`)
	} finally {
		root.dispose()
	}
})

it(`restores stopped events after dispatch and releases pending restoration on disposal`, async () => {
	const host = document.createElement(`main`)
	document.body.append(host)
	const change = vi.fn((event: Event) => {
		event.stopPropagation()
	})
	const root = render(() => <input value="fixed" onInput={change} />, host)
	const input = host.querySelector(`input`)!
	input.value = `edit`
	input.dispatchEvent(new Event(`input`, { bubbles: true }))
	await vi.waitFor(() => {
		expect(input.value).toBe(`fixed`)
	})
	input.value = `pending`
	input.dispatchEvent(new Event(`input`, { bubbles: true }))
	root.dispose()
	input.dispatchEvent(new Event(`input`, { bubbles: true }))
	await new Promise((resolve) => setTimeout(resolve, 5))
	expect(input.value).toBe(`pending`)
	expect(change).toHaveBeenCalledTimes(2)
	host.remove()
})

it(`bubbles focus/blur, removes reflected attributes, and focuses inserted autoFocus controls`, () => {
	const silo = new Silo({
		name: `attributes`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const showAtom = silo.atom<boolean>({ key: `show`, default: false })
	const labelAtom = silo.atom<string | undefined>({
		key: `label`,
		default: `tip`,
	})
	const events: string[] = []
	const host = document.createElement(`main`)
	document.body.append(host)
	const root = render(
		() => {
			const getShow = useGetter(showAtom),
				getLabel = useGetter(labelAtom)
			return (
				<section
					title={getLabel()}
					id={getLabel()}
					onFocusCapture={() => {
						events.push(`capture`)
					}}
					onFocus={() => {
						events.push(`focus`)
					}}
					onBlur={() => {
						events.push(`blur`)
					}}
				>
					{getShow() ? <input autoFocus /> : null}
				</section>
			)
		},
		host,
		{ store: silo.store },
	)
	try {
		silo.setState(showAtom, true)
		root.flush()
		const input = host.querySelector(`input`)!
		expect(document.activeElement).toBe(input)
		expect(events).toEqual([`capture`, `focus`])
		input.blur()
		expect(events).toEqual([`capture`, `focus`, `blur`])
		silo.setState(labelAtom, undefined)
		root.flush()
		expect(host.querySelector(`section`)!.hasAttribute(`title`)).toBe(false)
		expect(host.querySelector(`section`)!.hasAttribute(`id`)).toBe(false)
	} finally {
		root.dispose()
		host.remove()
	}
})

it(`skips autofocus callbacks whose owner has already been disposed`, () => {
	function Aborted() {
		onMount(() => {
			dispose(owner!)
		})
		return <input autoFocus />
	}
	const host = document.createElement(`main`)
	const root = render(() => <Aborted />, host)
	expect(host.querySelector(`input`)).toBeNull()
	root.dispose()
})
