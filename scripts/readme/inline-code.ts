import type { Component } from "galley.md"

export const InlineCode: Component<{ value: string }> = ({ value }) => ({
	type: `inlineCode`,
	value,
})
