import type { Children, SpaElement } from "@atom.io/spa"

import type { Path, Tools } from "./store.ts"
import { useExpanded } from "./store.ts"
import type { Change, JsonKind } from "./value.ts"
import { convert, describe, kind } from "./value.ts"

interface EditorProps {
	tools: Tools
	value: unknown
	change?: Change | undefined
	path: Path
	ancestors?: readonly unknown[]
	label?: Children
	actions?: Children
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
	const circular = () =>
		(props.ancestors?.includes(props.value) ?? false) || props.path.length > 50
	const container = () =>
		!circular() &&
		(kind(props.value) === `object` || kind(props.value) === `array`)
	const entries = () => Object.entries(props.value as Record<string, unknown>)
	return (
		<section
			class="json-editor"
			data-testid={`${props.path.join(`.`)}-state-editor`}
		>
			<header>
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
					<span class="carat-spacer" />
				)}
				<span class="field-name">{props.label}</span>
				{props.change ? (
					<select
						aria-label={`Type of ${props.path.at(-1)}`}
						value={kind(props.value)}
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
					<small>{kind(props.value)}</small>
				)}
				{container() ? (
					<code title={describe(props.value)}>{describe(props.value)}</code>
				) : circular() ? (
					<code>[Circular]</code>
				) : (
					<Primitive
						value={props.value}
						change={props.change}
						tools={props.tools}
						label={props.path.at(-1) ?? `value`}
					/>
				)}
				{props.actions}
			</header>
			{container() && getExpanded() ? (
				<section class="properties">
					{entries().map(([key]) => (
						<Property key={key} name={key} editor={props} />
					))}
					{props.change ? (
						<footer>
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
						</footer>
					) : null}
				</section>
			) : null}
		</section>
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
		<span class="primitive" data-kind={kind(props.value)}>
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
					class="elastic-input"
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
				<code>{describe(props.value)}</code>
			)}
		</span>
	)
}
function Property(props: { name: string; editor: EditorProps }): SpaElement {
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
		<section class="property">
			<JsonEditor
				label={
					parent.change && !Array.isArray(parent.value) ? (
						<input
							aria-label={`Rename ${props.name}`}
							class="elastic-input"
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
		</section>
	)
}
