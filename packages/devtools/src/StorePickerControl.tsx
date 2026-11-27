/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"
import { onCleanup, onCommit, onMount } from "@atom.io/spa"
import type { RootStore } from "atom.io/internal"

import type { StorePicker } from "./mount.ts"
import { useLocal } from "./store.ts"
import css from "./StorePickerControl.module.css"

export function StorePickerControl(props: {
	picker: StorePicker
	store: RootStore
	menuId: string
}): SpaElement {
	const { picker, menuId } = props
	const label = picker.targets.find(({ id }) => id === picker.id)!.label
	const [open, setOpen] = useLocal(props.store, false)
	let host: HTMLElement | null = null
	let trigger: HTMLButtonElement | null = null
	onMount(() => {
		const root = host!
		const doc = root.ownerDocument
		const dismiss = (event: Event) => {
			if (open() && !root.contains(event.target as Node)) setOpen(false)
		}
		doc.addEventListener(`pointerdown`, dismiss, true)
		doc.addEventListener(`focusin`, dismiss)
		onCleanup(() => {
			doc.removeEventListener(`pointerdown`, dismiss, true)
			doc.removeEventListener(`focusin`, dismiss)
		})
	})
	onCommit(open, () => {
		if (open())
			host!
				.querySelector<HTMLButtonElement>(`button[aria-current="true"]`)!
				.focus()
	})
	const close = () => {
		setOpen(false)
		trigger!.focus()
	}
	return (
		<store-picker-control
			class={css.class}
			data-store-picker
			data-menu-open={open() || undefined}
			ref={(element) => {
				host = element
			}}
			onKeyDown={(event) => {
				if (event.key !== `Escape` || !open()) return
				event.preventDefault()
				event.stopPropagation()
				close()
			}}
		>
			<button
				type="button"
				data-store-trigger
				aria-label={`Inspected store: ` + label}
				aria-expanded={open()}
				aria-controls={menuId}
				title={label}
				ref={(element) => {
					trigger = element
				}}
				onClick={() => {
					setOpen((previous) => !previous)
				}}
			>
				<span data-store-name>{label}</span>
				<span data-store-caret aria-hidden="true" />
			</button>
			<section
				data-store-menu
				id={menuId}
				hidden={!open()}
				role="group"
				aria-label="Stores"
			>
				<store-menu-options>
					{([`local`, `remote`] as const).map((kind) => {
						const targets = picker.targets.filter(
							(target) => target.kind === kind,
						)
						const headingId = menuId + `-` + kind
						return targets.length ? (
							<section
								key={kind}
								data-store-group
								role="group"
								aria-labelledby={headingId}
							>
								<p id={headingId}>{kind === `local` ? `Local` : `Remote`}</p>
								{targets.map((target) => (
									<button
										key={target.id}
										type="button"
										data-store-option={target.id}
										aria-current={target.id === picker.id ? `true` : undefined}
										onClick={() => {
											close()
											picker.select(target.id)
										}}
									>
										{target.label}
									</button>
								))}
							</section>
						) : null
					})}
				</store-menu-options>
			</section>
		</store-picker-control>
	)
}
