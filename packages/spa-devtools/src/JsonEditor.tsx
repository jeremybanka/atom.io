/** @jsxImportSource @atom.io/spa */
import type { Children, SpaElement } from "@atom.io/spa"

import css from "./JsonEditor.module.css"
import type { Path, Tools } from "./store.ts"
import { useExpanded } from "./store.ts"
import type { Change, JsonKind } from "./value.ts"
import { convert, describe, kind, preview, shallowKind } from "./value.ts"

interface EditorProps {
	tools: Tools
	stateKey?: string | undefined
	value: unknown
	change?: Change | undefined
	path: Path
	ancestors?: readonly unknown[]
	label?: Children
	actions?: Children
	shallow?: boolean | undefined
}
const TYPES: JsonKind[] = [
	`string`,
	`number`,
	`boolean`,
	`null`,
	`array`,
	`object`,
]
export function JsonEditor(props: EditorProps): SpaElement {
	const [getExpanded, toggle] = useExpanded(props.tools, props.path)
	const valueKind = () =>
		props.shallow ? shallowKind(props.value) : kind(props.value)
	const summary = () =>
		props.shallow ? preview(props.value) : describe(props.value)
	const circular = () =>
		(props.ancestors?.includes(props.value) ?? false) || props.path.length > 50
	const container = () =>
		!circular() && (valueKind() === `object` || valueKind() === `array`)
	const entries = () => Object.entries(props.value as Record<string, unknown>)
	return (
		<json-editor
			class={css.class}

			data-root={props.ancestors === undefined}
			data-depth={Math.min(3, props.ancestors?.length ?? 0)}
			data-testid={`${props.path.join(`.`)}-state-editor`}
		>
			<editor-row>
				{container() ? (
					<button
						type="button"
						aria-label={`Expand ${props.path.at(-1)}`}
						aria-expanded={getExpanded()}
						onClick={toggle}
					>
						{getExpanded() ? `▾` : `▸`}
					</button>
				) : (
					<carat-spacer />
				)}
				<field-name>{props.label}</field-name>
				{props.change &&
				(!props.tools.worker || props.stateKey !== undefined) ? (
					<select
						aria-label={`Type of ${props.path.at(-1)}`}
						value={valueKind()}
						onChange={(event) => {
							const type = event.currentTarget.value as JsonKind
							props.tools.attempt(() => {
								props.change?.((previous) => convert(previous, type))
							})
						}}
					>
						<option value="other" disabled>
							other
						</option>
						{TYPES.map((type) => (
							<option value={type}>{type}</option>
						))}
					</select>
				) : (
					<small>{valueKind()}</small>
				)}
				{container() ? (
					<code title={summary()}>{summary()}</code>
				) : circular() ? (
					<code>[Circular]</code>
				) : props.shallow && valueKind() === `other` ? (
					<code>{summary()}</code>
				) : (
					<Primitive
						value={props.value}
						change={props.change}
						tools={props.tools}
						label={props.path.at(-1) ?? `value`}
						stateKey={props.stateKey}
					/>
				)}
				{props.actions}
			</editor-row>
			{container() && getExpanded() ? (
				<json-properties>
					{entries().map(([key]) => (
						<Property key={key} name={key} editor={props} />
					))}
					{props.change ? (
						<editor-actions>
							<button
								type="button"
								onClick={() => {
									props.tools.attempt(() => {
										props.change?.((previous) => {
											if (Array.isArray(previous)) return [...previous, null]
											const object = previous as Record<string, unknown>
											let name = `new`
											while (Object.hasOwn(object, name)) name += `_`
											return { ...object, [name]: null }
										})
									})
								}}
							>
								add {Array.isArray(props.value) ? `item` : `property`}
							</button>
							{Array.isArray(props.value) ? (
								<button
									type="button"
									onClick={() => {
										props.tools.attempt(() => {
											props.change?.((previous) =>
												[...(previous as unknown[])].sort((a, b) =>
													typeof a === `number` && typeof b === `number`
														? a - b
														: describe(a).localeCompare(describe(b)),
												),
											)
										})
									}}
								>
									sort
								</button>
							) : null}
						</editor-actions>
					) : null}
				</json-properties>
			) : null}
		</json-editor>
	)
}
function Primitive(props: {
	value: unknown
	change?: Change | undefined
	tools: Tools
	label: string
	stateKey?: string | undefined
}): SpaElement {
	let draft: { text: string; value: number } | undefined
	const worker = props.tools.worker
	let workerDraft: { text: string; revision: number | undefined } | undefined
	const displayValue = () => {
		const value = props.value
		if (workerDraft) return workerDraft.text
		if (draft && Object.is(draft.value, value)) return draft.text
		draft = undefined
		return String(value)
	}
	const set = (value: unknown, revision?: number) => {
		props.tools.attempt(() => {
			props.change?.(() => value, revision)
		})
	}
	return (
		<json-primitive data-kind={kind(props.value)}>
			{kind(props.value) === `boolean` ? (
				<input
					aria-label={props.label}
					type="checkbox"
					checked={Boolean(props.value)}
					disabled={!props.change}
					onChange={(event) => {
						const checked = event.currentTarget.checked
						if (worker) event.currentTarget.checked = Boolean(props.value)
						set(checked)
					}}
				/>
			) : kind(props.value) === `string` || kind(props.value) === `number` ? (
				<input
					aria-label={props.label}
					type="text"
					data-elastic-input
					size={Math.max(1, displayValue().length)}
					inputmode={kind(props.value) === `number` ? `decimal` : `text`}
					value={displayValue()}
					readOnly={!props.change}
					onInput={(event) => {
						const text = event.currentTarget.value
						event.currentTarget.size = Math.max(1, text.length)
						if (worker) {
							workerDraft ??= {
								text,
								revision: worker.revision(props.stateKey ?? props.label),
							}
							workerDraft.text = text
							return
						}
						const value = props.value
						if (typeof value === `number`) {
							const number = Number(text)
							const valid = text.trim() !== `` && Number.isFinite(number)
							draft = { text, value: valid ? number : value }
							if (valid) set(number)
						} else set(text)
					}}
					onKeyDown={
						worker && props.change
							? (event) => {
									if (event.key === `Escape`) workerDraft = undefined
									if (event.key === `Enter` || event.key === `Escape`)
										event.currentTarget.blur()
								}
							: undefined
					}
					onBlur={(event) => {
						const submitted = workerDraft
						workerDraft = undefined
						draft = undefined
						event.currentTarget.value = String(props.value)
						event.currentTarget.size = Math.max(
							1,
							event.currentTarget.value.length,
						)
						if (!submitted) return
						if (typeof props.value === `number`) {
							const number = Number(submitted.text)
							if (submitted.text.trim() !== `` && Number.isFinite(number))
								set(number, submitted.revision)
						} else set(submitted.text, submitted.revision)
					}}
				/>
			) : (
				<code tabIndex={0} title="Scroll horizontally to read the full value">
					{describe(props.value)}
				</code>
			)}
		</json-primitive>
	)
}
function Property(props: { name: string; editor: EditorProps }): SpaElement {
	const parent = props.editor
	let renameDraft: { revision: number | undefined } | undefined
	const read = () => (parent.value as Record<string, unknown>)[props.name]
	const change: Change = (update, revision) => {
		parent.change?.((previous) => {
			if (Array.isArray(previous))
				return previous.map((value, index) =>
					index === Number(props.name) ? update(value) : value,
				)
			const object = previous as Record<string, unknown>
			return { ...object, [props.name]: update(object[props.name]) }
		}, revision)
	}
	return (
		<json-property>
			<JsonEditor
				label={
					parent.change && !Array.isArray(parent.value) ? (
						<input
							aria-label={`Rename ${props.name}`}
							data-elastic-input
							size={Math.max(1, props.name.length)}
							onInput={(event) => {
								renameDraft ??= {
									revision: parent.tools.worker?.revision(parent.stateKey!),
								}
								event.currentTarget.size = Math.max(
									1,
									event.currentTarget.value.length,
								)
							}}
							defaultValue={props.name}
							onKeyDown={(event) => {
								if (event.key === `Enter`) event.currentTarget.blur()
							}}
							onBlur={(event) => {
								const input = event.currentTarget
								const name = input.value
								const revision = renameDraft?.revision
								renameDraft = undefined
								parent.tools.attempt(() => {
									if (name === props.name) return
									parent.change?.((previous) => {
										const object = previous as Record<string, unknown>
										if (Object.hasOwn(object, name))
											throw new Error(`Property "${name}" already exists`)
										return Object.fromEntries(
											Object.entries(object).map(([key, value]) => [
												key === props.name ? name : key,
												value,
											]),
										)
									}, revision)
								})
								input.value = props.name
								input.size = Math.max(1, props.name.length)
							}}
						/>
					) : (
						<strong>{props.name}</strong>
					)
				}
				actions={
					parent.change ? (
						<button
							type="button"
							aria-label={`Delete ${props.name}`}
							onClick={() => {
								parent.tools.attempt(() => {
									parent.change?.((previous) =>
										Array.isArray(previous)
											? previous.filter(
													(_, index) => index !== Number(props.name),
												)
											: Object.fromEntries(
													Object.entries(previous as object).filter(
														([key]) => key !== props.name,
													),
												),
									)
								})
							}}
						>
							×
						</button>
					) : null
				}
				tools={parent.tools}
				stateKey={parent.stateKey}
				path={[...parent.path, props.name]}
				value={read()}
				change={parent.change ? change : undefined}
				ancestors={[...(parent.ancestors ?? []), parent.value]}
			/>
		</json-property>
	)
}
