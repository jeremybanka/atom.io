import type { Canonical } from "atom.io/foundations/canonical"
import { packCanonical } from "atom.io/foundations/canonical"

import type { Children, SpaElement } from "./core.ts"
import { mayHaveKey } from "./props.ts"

type Props = SpaElement[`props`]
type Key = Canonical | undefined
type Identity = string | number

function childProps(value: Children): Props | undefined {
	return (value as SpaElement | null)?.props
}

function hasPotentialKey(value: Children): boolean {
	if (Array.isArray(value)) return value.some(hasPotentialKey)
	const props = childProps(value)
	return props !== undefined && mayHaveKey(props)
}

/** Give direct JSX output the same key tracking as a reactive child expression. */
export function trackKeys(value: Children): Children {
	return hasPotentialKey(value) ? () => value : value
}

export function identifyChildren(
	output: Children,
	duplicate = `spa: duplicate key`,
): { value: Children; key: Key; id: Identity }[] {
	const values = ([output] as unknown[]).flat(Infinity) as Children[]
	const seen = new Set<string>()
	return values.map((value, index) => {
		const key: Key = childProps(value)?.[`key`]
		if (key === undefined) return { value, key, id: index }
		const id = packCanonical(key)
		if (seen.has(id)) throw new Error(duplicate)
		seen.add(id)
		return { value, key, id }
	})
}
