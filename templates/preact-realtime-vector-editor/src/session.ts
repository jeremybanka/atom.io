import { identityById, type Identity } from "./identities.ts"

const IDENTITY_KEY = `plane-collaboration-identity`

export function getBrowserSession(): { identity: Identity; sessionId: string } {
	const requested = new URL(window.location.href).searchParams.get(`as`)
	const identity = identityById(
		requested ?? window.localStorage.getItem(IDENTITY_KEY),
	)
	window.localStorage.setItem(IDENTITY_KEY, identity.id)
	return { identity, sessionId: `browser:${window.crypto.randomUUID()}` }
}

export function switchBrowserIdentity(identityId: string): void {
	window.localStorage.setItem(IDENTITY_KEY, identityId)
	const url = new URL(window.location.href)
	url.searchParams.set(`as`, identityId)
	window.location.assign(url)
}
