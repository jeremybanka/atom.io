import type { Canonical } from "atom.io/foundations/canonical"
import { packCanonical } from "atom.io/foundations/canonical"

import type { Children, SpaElement } from "./core.ts"

type Props = SpaElement[`props`]
type Key = Canonical | undefined
type Identity = string | number

function childProps(value: Children): Props | undefined {
	return (value as SpaElement | null)?.props
}

function hasKey(value: Children): boolean {
	if (Array.isArray(value)) return value.some(hasKey)
	const props = childProps(value)
	return props !== undefined && Object.hasOwn(props, `key`)
}

/** Direct output opts into key tracking when it first mounts. */
export function trackKeys(value: Children): Children {
	return hasKey(value) ? () => value : value
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
