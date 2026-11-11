import type { Canonical } from "atom.io/foundations/canonical"

import type { SpaElement } from "./core.ts"

type Props = SpaElement[`props`]
type FixedKey = { value: Canonical | undefined; present: boolean }

function liveProps(values: () => Props[], fixedKey?: FixedKey): Props {
	const source = (name: PropertyKey) =>
		values()
			.reverse()
			.find((props) => Object.hasOwn(props, name))
	const has = (_: Props, name: PropertyKey): boolean =>
		fixedKey && name === `key` ? fixedKey.present : source(name) !== undefined
	return new Proxy(
		{},
		{
			has,
			get(_, name) {
				if (fixedKey && name === `key`) return fixedKey.value
				const props = source(name)
				return props && Reflect.get(props, name)
			},
			ownKeys() {
				const keys = new Set(values().flatMap(Object.keys))
				if (fixedKey?.present) keys.add(`key`)
				else if (fixedKey) keys.delete(`key`)
				return [...keys]
			},
			getOwnPropertyDescriptor(_, name) {
				if (has(_, name)) return { enumerable: true, configurable: true }
			},
		},
	)
}

/** Preserve lazy props and spread precedence, including keys added by later updates. */
export function merge(...sources: (Props | (() => Props))[]): Props {
	return liveProps(() =>
		sources.map(
			(source) => (typeof source === `function` ? source() : source) ?? {},
		),
	)
}

/** Expose the first key while leaving data props live, including through spreads. */
export function instanceProps(
	read: () => Props,
	key: Canonical | undefined,
): Props {
	return liveProps(() => [read()], {
		value: key,
		present: key !== undefined || Object.hasOwn(read(), `key`),
	})
}
