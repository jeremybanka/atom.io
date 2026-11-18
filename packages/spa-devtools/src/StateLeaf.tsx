/** @jsxImportSource @atom.io/spa */
import type { Children, SpaElement } from "@atom.io/spa"
import { onCleanup, onMount, useGetter, useId, useSetter } from "@atom.io/spa"
import { bindScene } from "@atom.io/spa/renderer"
import type { ReadableToken, WritableToken } from "atom.io"
import {
	disposeFromStore,
	getFromStore,
	subscribeToStateSubject,
} from "atom.io/internal"

import { JsonEditor } from "./JsonEditor.tsx"
import css from "./StateLeaf.module.css"
import { type Tools, useLocal } from "./store.ts"

type Token = ReadableToken<unknown, any, any>
export function StateLeaf(props: {
	tools: Tools
	token: Token
	grouped?: boolean
	separated?: boolean
	retained?: boolean
	cachedOnly?: boolean
	capture?: unknown
	label?: Children
	onGenerate?(): void
}): SpaElement {
	const token = props.token
	const definition = () =>
		props.tools.store.atoms.get(token.key) ??
		props.tools.store.readonlySelectors.get(token.key) ??
		props.tools.store.writableSelectors.get(token.key)
	const captured = definition()
	const getValue = useGetter(token)
	const cache = props.cachedOnly
		? (() => {
				const read = () => {
					void props.capture
					return {
						present: props.tools.store.valueMap.has(token.key),
						value: props.tools.store.valueMap.get(token.key) as unknown,
					}
				}
				// Uncached rows have no live controls until Generate/Refresh; avoid a local atom per dormant state.
				if (!read().present) return read
				const [get, set] = useLocal(props.tools.store, read())
				const id = useId()
				onMount(() => {
					onCleanup(
						subscribeToStateSubject(captured!, `ecology-editor-${id}`, () => {
							set(read())
						}),
					)
					bindScene(
						() => props.capture,
						() => {
							set(read())
						},
					)
				})
				return get
			})()
		: undefined
	const writable = !token.type.startsWith(`readonly`)
	const setValue = writable
		? useSetter(token as WritableToken<unknown, any, any>)
		: undefined
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
					<button
						type="button"
						aria-label={`Generate ${token.key}`}
						onClick={() => {
							props.tools.attempt(() => {
								if (definition() !== captured)
									throw new Error(
										`State was disposed. Refresh to update the snapshot.`,
									)
								getFromStore(props.tools.store, token)
								props.onGenerate?.()
							})
						}}
					>
						Generate
					</button>
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
						token.family ? (
							<button
								type="button"
								aria-label={`Dispose ${token.key}`}
								onClick={() => {
									props.tools.attempt(() => {
										disposeFromStore(props.tools.store, token)
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
									const next = update(
										cache
											? props.tools.store.valueMap.get(token.key)
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
