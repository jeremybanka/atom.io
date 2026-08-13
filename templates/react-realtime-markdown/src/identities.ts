export type Identity = {
	readonly color: string
	readonly id: string
	readonly name: string
}

export const SIMULATED_IDENTITIES = [
	{ id: `maya`, name: `Maya Chen`, color: `#7c5cff` },
	{ id: `theo`, name: `Theo Brooks`, color: `#eb5e8d` },
	{ id: `samira`, name: `Samira Okafor`, color: `#1aa981` },
	{ id: `noah`, name: `Noah Williams`, color: `#e8892f` },
] as const satisfies readonly Identity[]

export function identityById(id: string | null | undefined): Identity {
	return (
		SIMULATED_IDENTITIES.find((identity) => identity.id === id) ??
		SIMULATED_IDENTITIES[0]
	)
}

export function identityFromUserKey(userKey: string): Identity {
	return identityById(userKey.replace(/^user::/, ``).split(`::`)[0])
}
