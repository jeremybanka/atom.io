import type {
	ActorToolkit,
	TransactionOutcomeEvent,
	TransactionToken,
} from "atom.io"

import type { Fn } from "../utility-types.ts"

export const TRANSACTION_PHASES = [`idle`, `building`, `applying`] as const
export type TransactionPhase = (typeof TRANSACTION_PHASES)[number]

export type TransactionProgress<F extends Fn> = {
	phase: `applying` | `building`
	update: TransactionOutcomeEvent<TransactionToken<F>>
	toolkit: ActorToolkit
}

export type RootTransactionMeta = {
	phase: `idle`
}
