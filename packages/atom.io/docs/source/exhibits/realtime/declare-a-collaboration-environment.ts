import { Silo } from "atom.io"
import { collaborationEnvironment } from "atom.io/realtime"
import { z } from "zod"

const documentSilo = new Silo({
	isProduction: false,
	lifespan: `ephemeral`,
	name: `document`,
})

export const titleAtom = documentSilo.atom<string>({
	default: `Untitled`,
	key: `title`,
})

export const blockAtoms = documentSilo.atomFamily<string, string>({
	default: ``,
	key: `block`,
})

export const selectedBlockAtom = documentSilo.atom<string | null>({
	default: null,
	key: `selectedBlock`,
})

export const cursorAtoms = documentSilo.atomFamily<number, string>({
	default: 0,
	key: `cursor`,
})

export const titleLengthSelector = documentSilo.selector<number>({
	get: ({ get }) => get(titleAtom).length,
	key: `titleLength`,
})

export const documentEnvironment = collaborationEnvironment({
	configSchema: z.object({ room: z.string().min(1) }),
	key: `document`,
	members: {
		blocks: {
			keySchema: z.string().min(1),
			role: `durable`,
			schema: z.string(),
			token: blockAtoms,
		},
		cursor: {
			keySchema: z.string().min(1),
			role: `ephemeral`,
			schema: z.number().int().nonnegative(),
			token: cursorAtoms,
		},
		selectedBlock: {
			role: `local`,
			token: selectedBlockAtom,
		},
		title: {
			role: `durable`,
			schema: z.string(),
			token: titleAtom,
		},
		titleLength: {
			role: `derived`,
			token: titleLengthSelector,
		},
	},
	version: 1,
})

export const documentEnvironmentActivationPromise = documentEnvironment.activate(
	{
		config: { room: `documents` },
		instance: `design-notes`,
		store: documentSilo.store,
	},
)
