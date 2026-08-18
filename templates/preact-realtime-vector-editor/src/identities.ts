export type Identity = {
	readonly color: string
	readonly id: string
	readonly name: string
}

export const SIMULATED_IDENTITIES = [
	{ id: `maya`, name: `Maya Chen`, color: `#8b7bff` },
	{ id: `theo`, name: `Theo Brooks`, color: `#ff6b9a` },
	{ id: `samira`, name: `Samira Okafor`, color: `#21c9a2` },
	{ id: `noah`, name: `Noah Williams`, color: `#ff9d4d` },
] as const satisfies readonly Identity[]

export function identityById(id: string | null | undefined): Identity {
	return (
		SIMULATED_IDENTITIES.find((identity) => identity.id === id) ??
		SIMULATED_IDENTITIES[0]
	)
}
