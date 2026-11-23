// Plain views shared by both sides; all state and lifecycle decisions stay in the exhibits.
import type { ReactNode, RefObject } from "react"

import type { Product } from "./services.ts"

export function DocumentPicker({
	documentId,
	onChange,
}: {
	documentId: string
	onChange: (documentId: string) => void
}): ReactNode {
	return (
		<label>
			Document
			<select
				value={documentId}
				onChange={(event) => {
					onChange(event.currentTarget.value)
				}}
			>
				<option>Document A</option>
				<option>Document B</option>
			</select>
		</label>
	)
}

export function DraftForm({
	text,
	onChange,
	status,
	label = `Draft`,
}: {
	text: string
	onChange: (text: string) => void
	status?: string
	label?: string
}): ReactNode {
	return (
		<>
			<label>
				{label}
				<textarea
					value={text}
					onChange={(event) => {
						onChange(event.currentTarget.value)
					}}
				/>
			</label>
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
}): ReactNode {
	return (
		<>
			<label>
				Search products
				<input
					value={query}
					onChange={(event) => {
						onChange(event.currentTarget.value)
					}}
				/>
			</label>
			<output>
				{failed
					? `Search failed.`
					: results.length
						? results.map((product) => product.name).join(`, `)
						: `No products found.`}
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
}): ReactNode {
	return (
		<label>
			<input
				type="checkbox"
				checked={checked}
				onChange={(event) => {
					onChange(event.currentTarget.checked)
				}}
			/>
			Collapse sidebar
		</label>
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
}): ReactNode {
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
