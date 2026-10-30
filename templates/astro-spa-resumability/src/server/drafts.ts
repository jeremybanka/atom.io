import { randomUUID } from "node:crypto"
import { DatabaseSync } from "node:sqlite"

import readDraftQuery from "./read-draft.sql"

/** Both SSR and tRPC use this function and its inferred query result. */
// oxlint-disable-next-line typescript/explicit-module-boundary-types -- Infer the response from Reylo's content-mapped SQL type; tsc verifies the full RPC contract.
export function readDraft(id: number) {
	const database = new DatabaseSync(`drafts.sqlite`, { readOnly: true })
	try {
		const draft = readDraftQuery.runSync(database, { id })
		if (!draft) throw new Error(`Draft ${id} does not exist`)
		return { ...draft, revision: randomUUID() }
	} finally {
		database.close()
	}
}
