import { stringifyJson } from "atom.io/foundations/json"

import { PRETTY_ENTITY_NAMES } from "./logger.ts"
import type { AtomIOToken } from "./tokens.ts"

export class NotFoundError extends Error {
	public constructor(token: AtomIOToken, storeName: string) {
		super(
			`${PRETTY_ENTITY_NAMES[token.type]} ${stringifyJson(token.key)} not found in store "${storeName}".`,
		)
	}
}
