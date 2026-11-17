/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"
import { useGetter, useSetter } from "@atom.io/spa"
import type { ReadableToken, WritableToken } from "atom.io"
import { disposeFromStore } from "atom.io/internal"

import { JsonEditor } from "./JsonEditor.tsx"
import css from "./StateLeaf.module.css"
import type { Tools } from "./store.ts"

type Token = ReadableToken<unknown, any, any>
export function StateLeaf(props: {
	tools: Tools
	token: Token
	grouped?: boolean
	separated?: boolean
	retained?: boolean
}): SpaElement {
	const definition = () =>
		props.tools.store.atoms.get(props.token.key) ??
		props.tools.store.readonlySelectors.get(props.token.key) ??
		props.tools.store.writableSelectors.get(props.token.key)
	const captured = definition()
	const getValue = useGetter(props.token)
	const writable = !props.token.type.startsWith(`readonly`)
	const setValue = writable
		? useSetter(props.token as WritableToken<unknown, any, any>)
		: undefined
	const value = () => {
		try {
			if (props.retained && definition() !== captured)
				return new Error(`State was disposed. Refresh to update the snapshot.`)
			return getValue()
		} catch (error) {
			return error
		}
	}
	return (
		<state-leaf
			class={css.class}
			data-grouped={props.grouped}
			data-separated={props.separated}
			data-state-key={props.token.key}
			data-testid={`state-value-${props.token.key}`}
		>
			<JsonEditor
				label={
					<h3 title={props.token.key}>
						{props.token.family?.subKey ?? props.token.key}
					</h3>
				}
				actions={
					props.token.family ? (
						<button
							type="button"
							aria-label={`Dispose ${props.token.key}`}
							onClick={() => {
								props.tools.attempt(() => {
									disposeFromStore(props.tools.store, props.token)
								})
							}}
						>
							×
						</button>
					) : null
				}
				tools={props.tools}
				value={value()}
				change={
					setValue
						? (update) => {
								// Validate edits before opening an atom.io write operation.
								const next = update(getValue())
								setValue(() => next)
							}
						: undefined
				}
				path={
					props.token.family
						? [props.token.family.key, props.token.family.subKey]
						: [props.token.key]
				}
			/>
		</state-leaf>
	)
}
