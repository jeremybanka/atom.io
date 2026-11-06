import { resetState } from "atom.io"

import { rowListAtom } from "./load-remote-rows.ts"

export function refreshRows(): void {
	// Reset the response atom. Its effect hydrates only the accepted response,
	// even if refresh is requested again before this request finishes.
	resetState(rowListAtom)
}
