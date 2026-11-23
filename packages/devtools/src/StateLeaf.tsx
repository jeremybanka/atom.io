/** @jsxImportSource @atom.io/spa */
import type { Children, SpaElement } from "@atom.io/spa"
import { useGetter, useSetter } from "@atom.io/spa"
import type { ReadableToken, WritableToken } from "atom.io"
import { disposeFromStore, getFromStore, resetInStore } from "atom.io/internal"
import { peekState } from "atom.io/introspection"

import { EditorButton } from "./EditorButton.tsx"
import { JsonEditor } from "./JsonEditor.tsx"
import css from "./StateLeaf.module.css"
import type { EditorTools } from "./store.ts"

type Token = ReadableToken<unknown, any, any>
export function StateLeaf(props: {
	tools: EditorTools
	token: Token
	grouped?: boolean
	separated?: boolean
	retained?: boolean
	cachedOnly?: boolean
	capture?: unknown
	revision?: number | undefined
	label?: Children
	onInitialize?(): void
}): SpaElement {
	const token = props.token
	const definition = () =>
		props.tools.store.atoms.get(token.key) ??
		props.tools.store.readonlySelectors.get(token.key) ??
		props.tools.store.writableSelectors.get(token.key)
	const captured = definition()
	const getValue = useGetter(token)
	const cache = props.cachedOnly
		? () => {
				void props.capture
				void props.revision
				return peekState(props.tools.store, token.key)
			}
		: undefined
	const writableToken = token.type.startsWith(`readonly`)
		? undefined
		: (token as WritableToken<unknown, any, any>)
	const setValue = writableToken ? useSetter(writableToken) : undefined
	const requireCurrent = () => {
		if (definition() !== captured)
			throw new Error(`State was disposed. Refresh to update the snapshot.`)
	}
	const resetButton = () =>
		writableToken && (
			<EditorButton
				icon="reset"
				label={`Reset ${token.key}`}
				onClick={() => {
					props.tools.attempt(() => {
						requireCurrent()
						const uncached = cache && !cache().present
						resetInStore(props.tools.store, writableToken)
						if (uncached) props.onInitialize?.()
					})
				}}
			/>
		)
	const value = () => {
		try {
			if (props.retained && definition() !== captured)
				return new Error(`State was disposed. Refresh to update the snapshot.`)
			return cache ? cache().value : getValue()
		} catch (error) {
			return error
		}
	}
	return (
		<state-leaf
			class={css.class}
			data-grouped={props.grouped}
			data-separated={props.separated}
			data-state-key={token.key}
			data-testid={`state-value-${token.key}`}
		>
			{cache && !cache().present ? (
				<node-heading>
					{props.label}
					<span>–</span>
					<EditorButton
						icon="generate"
						label={`Generate ${token.key}`}
						onClick={() => {
							props.tools.attempt(() => {
								requireCurrent()
								getFromStore(props.tools.store, token)
								props.onInitialize?.()
							})
						}}
					/>
					{resetButton()}
				</node-heading>
			) : (
				<JsonEditor
					shallow={props.cachedOnly}
					label={
						props.label ?? (
							<h3 title={token.key}>{token.family?.subKey ?? token.key}</h3>
						)
					}
					actions={
						<>
							{resetButton()}
							{token.family && (
								<EditorButton
									icon="remove"
									label={`Dispose ${token.key}`}
									onClick={() => {
										props.tools.attempt(() => {
											disposeFromStore(props.tools.store, token)
										})
									}}
								/>
							)}
						</>
					}
					tools={props.tools}
					value={value()}
					change={
						setValue
							? (update) => {
									// Validate edits before opening an atom.io write operation.
									const next = update(
										cache
											? peekState(props.tools.store, token.key).value
											: getValue(),
									)
									setValue(() => next)
								}
							: undefined
					}
					path={
						token.family ? [token.family.key, token.family.subKey] : [token.key]
					}
				/>
			)}
		</state-leaf>
	)
}
