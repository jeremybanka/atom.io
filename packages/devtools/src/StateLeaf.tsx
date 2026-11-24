/** @jsxImportSource @atom.io/spa */
import type { Children, SpaElement } from "@atom.io/spa"
import { onCleanup, onMount, useGetter, useSetter } from "@atom.io/spa"
import type { ReadableToken, WritableToken } from "atom.io"
import { disposeFromStore, getFromStore, resetInStore } from "atom.io/internal"
import { peekState, peekStateDefinition } from "atom.io/introspection"

import { EditorButton } from "./EditorButton.tsx"
import { JsonEditor } from "./JsonEditor.tsx"
import css from "./StateLeaf.module.css"
import type { EditorTools } from "./store.ts"
import type { RemoteCachedValue } from "./remote-protocol.ts"

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
	const definition = () => peekStateDefinition(props.tools.store, token.key)
	const captured = definition()
	const worker = props.tools.worker
	const canOperate = worker?.canControl() !== false
	const projection = worker?.cache(token.key)
	const watch =
		projection && worker!.canGenerate() && token.type.includes(`selector`)
			? worker!.watchSelector(token.key)
			: undefined
	if (watch) onCleanup(watch.dispose)
	const generate = (batch = false) => {
		if (watch) watch.generate(batch)
		else worker!.generate(token.key, batch)
	}
	const getValue = useGetter(projection ?? token)
	const cache = projection
		? () => {
				const remote = getValue() as RemoteCachedValue
				return remote.status === `value`
					? { present: true, value: remote.value }
					: { present: false, value: undefined }
			}
		: props.cachedOnly
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
		!worker &&
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
	onMount(() => {
		if (
			projection &&
			worker!.canGenerate() &&
			!props.cachedOnly &&
			(watch || !cache!().present)
		)
			props.tools.attempt(() => {
				generate(true)
			})
	})
	const value = () => {
		try {
			if (props.retained && definition() !== captured)
				return new Error(`State was disposed. Refresh to update the snapshot.`)
			return cache ? cache().value : getValue()
		} catch (error) {
			return error
		}
	}
	const canEdit = () => {
		if (!setValue) return false
		if (!worker) return true
		return (
			!(value() instanceof Error) && worker.revision(token.key) !== undefined
		)
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
					{props.label ?? <h3>{token.family?.subKey ?? token.key}</h3>}
					<span>–</span>
					{canOperate && (
						<EditorButton
							icon="generate"
							label={`Generate ${token.key}`}
							onClick={() => {
								props.tools.attempt(() => {
									requireCurrent()
									if (projection) generate()
									else {
										getFromStore(props.tools.store, token)
										props.onInitialize?.()
									}
								})
							}}
						/>
					)}
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
							{token.family && canOperate && (
								<EditorButton
									icon="remove"
									label={`Dispose ${token.key}`}
									onClick={() => {
										props.tools.attempt(() => {
											if (projection) worker!.disposeState(token.key)
											else disposeFromStore(props.tools.store, token)
										})
									}}
								/>
							)}
						</>
					}
					tools={props.tools}
					stateKey={token.key}
					value={value()}
					change={
						canEdit()
							? (update, revision) => {
									// Validate edits before opening an atom.io write operation.
									const next = update(cache ? cache().value : getValue())
									if (worker) worker.edit(token.key, next, revision)
									else setValue!(() => next)
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
