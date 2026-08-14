import { identityById } from "./identities.ts"

import type { Identity } from "./identities.ts"

const IDENTITY_KEY = `markdown-collab-identity`

export function getBrowserSession(): { clientId: string; identity: Identity } {
	const queryIdentity = new URL(window.location.href).searchParams.get(`as`)
	const storedIdentity = window.localStorage.getItem(IDENTITY_KEY)
	const identity = identityById(queryIdentity ?? storedIdentity)
	window.localStorage.setItem(IDENTITY_KEY, identity.id)

	const clientId = `browser:${window.crypto.randomUUID()}`
	return { clientId, identity }
}

export function realtimeAuth(
	identity: Identity,
	clientId: string,
): { sessionId: string; userId: string } {
	return { sessionId: clientId, userId: identity.id }
}

export function switchBrowserIdentity(identityId: string): void {
	window.localStorage.setItem(IDENTITY_KEY, identityId)
	const url = new URL(window.location.href)
	url.searchParams.set(`as`, identityId)
	window.location.assign(url)
}
