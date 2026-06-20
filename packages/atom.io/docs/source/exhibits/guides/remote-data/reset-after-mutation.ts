import { resetState, setState } from "atom.io"

import { client, type RowStatus } from "./client.ts"
import { rowAtoms } from "./load-remote-rows.ts"

type RowKey = `row::${string}`

export async function updateRowStatus(
	id: string,
	status: RowStatus,
): Promise<void> {
	const key: RowKey = `row::${id}`

	setState(rowAtoms, key, async (loadable) => {
		const row = await loadable
		if (row instanceof Error) return row
		return { ...row, status }
	})

	await client.rows.updateStatus({ id, status })

	// Reload this row from the remote, which owns its timestamp and final shape.
	resetState(rowAtoms, key)
}
