/** @jsxImportSource @atom.io/spa */
import type { Children, SpaElement } from "@atom.io/spa"

import css from "./JsonEditor.module.css"
import type { Path, Tools } from "./store.ts"
import { useExpanded } from "./store.ts"
import type { Change, JsonKind } from "./value.ts"
import { convert, describe, kind, preview, shallowKind } from "./value.ts"

interface EditorProps {
	tools: Tools
	value: unknown
	change?: Change | undefined
	path: Path
	ancestors?: readonly unknown[]
	label?: Children
	actions?: Children
	shallow?: boolean | undefined
}
interface ArrayReorder {
	start(event: DragEvent, index: number): void
	finish(): void
	move(from: number, to: number, items: readonly unknown[]): void
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
	const recast = (event: Event) => {
		const type = (event.currentTarget as HTMLSelectElement).value as JsonKind
		if (!TYPES.includes(type) || type === valueKind()) return
		props.tools.attempt(() => {
			props.change?.((previous) => convert(previous, type))
		})
	}
	let drag: { index: number; items: readonly unknown[] } | undefined
	let destination: HTMLElement | undefined
	const clearDestination = () => {
		destination?.removeAttribute(`data-array-drop`)
		destination = undefined
	}
	const reorder: ArrayReorder = {
		start(event, index) {
			const items = props.value as unknown[]
			if (!event.dataTransfer) return
			event.dataTransfer.effectAllowed = `move`
			event.dataTransfer.setData(`text/plain`, String(index))
			drag = { index, items }
		},
		finish() {
			drag = undefined
			clearDestination()
		},
		move(from, to, items) {
			if (from === to) return
			props.tools.attempt(() => {
				props.change?.((previous) => {
					if (previous !== items) return previous
					const next = items.slice()
					// Shift the range in place so holes in sparse arrays stay holes.
					if (from < to) next.copyWithin(from, from + 1, to + 1)
					else next.copyWithin(to + 1, to, from)
					next[to] = items[from]
					return next
				})
			})
		},
	}
	const dropRow = (event: DragEvent) => {
		const row = (event.target as Element).closest<HTMLElement>(`json-property`)
		if (
			row?.parentElement === event.currentTarget &&
			row.hasAttribute(`data-array-index`)
		)
			return row
	}
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
				{props.change ? (
					<select
						aria-label={`Type of ${props.path.at(-1)}`}
						value={valueKind()}
						onInput={recast}
						onChange={recast}
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
					/>
				)}
				{props.actions}
			</editor-row>
			{container() && getExpanded() ? (
				<json-properties
					onDragOver={(event) => {
						const row = dropRow(event)
						if (!drag || !row) return
						event.preventDefault()
						if (event.dataTransfer) event.dataTransfer.dropEffect = `move`
						if (destination === row) return
						clearDestination()
						const index = Number(row.dataset[`arrayIndex`])
						if (index === drag.index) return
						row.dataset[`arrayDrop`] = index < drag.index ? `before` : `after`
						destination = row
					}}
					onDragLeave={(event) => {
						if (!event.currentTarget.contains(event.relatedTarget))
							clearDestination()
					}}
					onDrop={(event) => {
						const row = dropRow(event)
						if (!drag || !row) return
						event.preventDefault()
						const { index, items } = drag
						reorder.finish()
						reorder.move(index, Number(row.dataset[`arrayIndex`]), items)
					}}
				>
					{entries().map(([key]) => (
						<Property
							key={key}
							name={key}
							editor={props}
							reorder={
								props.change &&
								Array.isArray(props.value) &&
								/^(0|[1-9]\d*)$/.test(key) &&
								Number(key) < props.value.length
									? reorder
									: undefined
							}
						/>
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
}): SpaElement {
	let draft: { text: string; value: number } | undefined
	const displayValue = () => {
		const value = props.value
		if (draft && Object.is(draft.value, value)) return draft.text
		draft = undefined
		return String(value)
	}
	const set = (value: unknown) => {
		props.tools.attempt(() => {
			props.change?.(() => value)
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
						set(event.currentTarget.checked)
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
						const value = props.value
						if (typeof value === `number`) {
							const number = Number(text)
							const valid = text.trim() !== `` && Number.isFinite(number)
							draft = { text, value: valid ? number : value }
							if (valid) set(number)
						} else set(text)
					}}
					onBlur={(event) => {
						draft = undefined
						event.currentTarget.value = String(props.value)
						event.currentTarget.size = Math.max(
							1,
							event.currentTarget.value.length,
						)
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
function Property(props: {
	name: string
	editor: EditorProps
	reorder?: ArrayReorder | undefined
}): SpaElement {
	const parent = props.editor
	const read = () => (parent.value as Record<string, unknown>)[props.name]
	const change: Change = (update) => {
		parent.change?.((previous) => {
			if (Array.isArray(previous))
				return previous.map((value, index) =>
					index === Number(props.name) ? update(value) : value,
				)
			const object = previous as Record<string, unknown>
			return { ...object, [props.name]: update(object[props.name]) }
		})
	}
	return (
		<json-property data-array-index={props.reorder ? props.name : undefined}>
			<JsonEditor
				label={
					props.reorder ? (
						<>
							<button
								type="button"
								data-array-handle
								draggable
								aria-label={`Reorder item ${props.name}`}
								aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
								title="Drag to reorder or press Alt+Up or Alt+Down"
								onDragStart={(event) =>
									props.reorder?.start(event, Number(props.name))
								}
								onDragEnd={() => props.reorder?.finish()}
								onKeyDown={(event) => {
									if (
										!event.altKey ||
										(event.key !== `ArrowUp` && event.key !== `ArrowDown`)
									)
										return
									event.preventDefault()
									const from = Number(props.name)
									const items = parent.value as unknown[]
									const row = (event.currentTarget as HTMLElement).closest(
										`json-property`,
									)!
									const target =
										event.key === `ArrowUp`
											? row.previousElementSibling
											: row.nextElementSibling
									if (!target?.hasAttribute(`data-array-index`)) return
									const index = target.getAttribute(`data-array-index`)
									props.reorder?.move(from, Number(index), items)
									target
										.querySelector<HTMLButtonElement>(`[data-array-handle]`)
										?.focus()
								}}
							>
								⠿
							</button>
							<strong>{props.name}</strong>
						</>
					) : parent.change && !Array.isArray(parent.value) ? (
						<input
							aria-label={`Rename ${props.name}`}
							data-elastic-input
							size={Math.max(1, props.name.length)}
							onInput={(event) => {
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
								parent.tools.attempt(() => {
									parent.change?.((previous) => {
										const object = previous as Record<string, unknown>
										if (name !== props.name && Object.hasOwn(object, name))
											throw new Error(`Property "${name}" already exists`)
										return Object.fromEntries(
											Object.entries(object).map(([key, value]) => [
												key === props.name ? name : key,
												value,
											]),
										)
									})
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
				path={[...parent.path, props.name]}
				value={read()}
				change={parent.change ? change : undefined}
				ancestors={[...(parent.ancestors ?? []), parent.value]}
			/>
		</json-property>
	)
}
