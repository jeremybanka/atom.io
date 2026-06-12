import type { TransactionToken } from "atom.io"

import type { Store } from "../store/index.ts"
import { withdraw } from "../store/index.ts"
import type { Fn } from "../utility-types.ts"

export function actUponStore<F extends Fn>(
	store: Store,
	token: TransactionToken<F>,
	id: string,
): (...parameters: Parameters<F>) => ReturnType<F> {
	return (...parameters: Parameters<F>): ReturnType<F> => {
		const tx = withdraw(store, token)
		return tx.run(parameters, id)
	}
}
