import { Silo } from "atom.io"

import { render, useGetter, useSetter } from "../src/index.ts"

export function formBehavior(): {
	options(): void
	autofocus(): void
	clearAttributes(): void
	inspect(): { edits: string[]; text: string; number: number }
	dispose(): void
} {
	const silo = new Silo({
		name: `browser-forms`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const textAtom = silo.atom<string>({ key: `text`, default: `abc` })
	const numberAtom = silo.atom<number>({ key: `number`, default: 0 })
	const optionsAtom = silo.atom<string[]>({ key: `options`, default: [] })
	const showAtom = silo.atom<boolean>({ key: `show`, default: false })
	const titleAtom = silo.atom<string | undefined>({
		key: `title`,
		default: `tip`,
	})
	const edits: string[] = []
	const host = document.createElement(`main`)
	host.style.cssText = `position:absolute;left:0;top:0;width:400px;background:white`
	document.body.append(host)
	function App() {
		const getText = useGetter(textAtom),
			setText = useSetter(textAtom)
		const getNumber = useGetter(numberAtom),
			setNumber = useSetter(numberAtom)
		const getOptions = useGetter(optionsAtom),
			getShow = useGetter(showAtom),
			getTitle = useGetter(titleAtom)
		return (
			<section
				id="form-attributes"
				title={getTitle()}
				onChange={(event) => {
					edits.push(`parent:${(event.target as HTMLInputElement).value}`)
				}}
				onFocus={() => {
					edits.push(`focus`)
				}}
				onBlur={() => {
					edits.push(`blur`)
				}}
			>
				<input
					id="form-reject"
					value={getText()}
					onInput={(event) => {
						edits.push(`input:${event.currentTarget.value}`)
					}}
				/>
				<input
					id="form-accept"
					value={getText()}
					onChange={(event) => {
						setText(event.currentTarget.value)
					}}
				/>
				<input
					id="form-stopped"
					value="fixed"
					onInput={(event) => {
						event.stopPropagation()
						edits.push(`stopped:${event.currentTarget.value}`)
					}}
				/>
				<input
					id="form-number"
					type="number"
					value={getNumber()}
					onChange={(event) => {
						setNumber(Number(event.currentTarget.value))
					}}
				/>
				<input
					id="form-checked"
					type="checkbox"
					checked={false}
					onChange={(event) => {
						edits.push(`checked:${event.currentTarget.checked}`)
					}}
				/>
				<input id="form-radio-a" type="radio" name="browser-group" checked />
				<input
					id="form-radio-b"
					type="radio"
					name="browser-group"
					checked={false}
				/>
				<textarea
					id="form-area"
					value={getText()}
					onChange={(event) => {
						setText(event.currentTarget.value)
					}}
				/>
				<select id="form-select" value="b">
					{getOptions().map((value) => (
						<option key={value} value={value}>
							{value}
						</option>
					))}
				</select>
				<input id="form-default" defaultValue="seed" />
				{getShow() ? <input id="form-auto" autoFocus /> : null}
			</section>
		)
	}
	const root = render(() => <App />, host, { store: silo.store })
	return {
		options(): void {
			silo.setState(optionsAtom, [`a`, `b`, `c`])
			root.flush()
		},
		autofocus(): void {
			silo.setState(showAtom, true)
			root.flush()
		},
		clearAttributes(): void {
			silo.setState(titleAtom, undefined)
			root.flush()
		},
		inspect(): { edits: string[]; text: string; number: number } {
			return {
				edits,
				text: silo.getState(textAtom),
				number: silo.getState(numberAtom),
			}
		},
		dispose(): void {
			root.dispose()
			host.remove()
		},
	}
}
