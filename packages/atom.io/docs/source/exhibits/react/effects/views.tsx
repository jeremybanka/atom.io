// Plain views shared by both sides; all state and lifecycle decisions stay in the exhibits.
import type { RefObject } from "react"

import type { Product } from "./services.ts"

export function DraftForm({
	text,
	onChange,
	status,
	label,
}: {
	text: string
	onChange: (text: string) => void
	status?: string
	label?: string
}) {
	return (
		<>
			<textarea
				aria-label={label}
				value={text}
				onChange={(event) => onChange(event.currentTarget.value)}
			/>
			{status && <output>{status}</output>}
		</>
	)
}

export function SearchForm({
	query,
	onChange,
	results,
	failed = false,
}: {
	query: string
	onChange: (query: string) => void
	results: readonly Product[]
	failed?: boolean
}) {
	return (
		<>
			<input
				value={query}
				onChange={(event) => onChange(event.currentTarget.value)}
			/>
			<output>
				{failed ? `Failed` : results.map((product) => product.name).join(`, `)}
			</output>
		</>
	)
}

export function PreferenceToggle({
	checked,
	onChange,
}: {
	checked: boolean
	onChange: (checked: boolean) => void
}) {
	return (
		<input
			type="checkbox"
			checked={checked}
			onChange={(event) => onChange(event.currentTarget.checked)}
		/>
	)
}

export function MessageList({
	listRef,
	messages,
	onFollowChange,
}: {
	listRef: RefObject<HTMLDivElement | null>
	messages: readonly string[]
	onFollowChange: (following: boolean) => void
}) {
	return (
		<div
			ref={listRef}
			style={{ height: 200, overflow: `auto` }}
			onScroll={(event) => {
				const node = event.currentTarget
				onFollowChange(
					node.scrollHeight - node.scrollTop - node.clientHeight < 8,
				)
			}}
		>
			{messages.map((message, index) => (
				<p key={index}>{message}</p>
			))}
		</div>
	)
}
