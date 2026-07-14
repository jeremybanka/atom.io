import { transaction } from "atom.io"

export const doubleTransaction = transaction<(amount: number) => number>({
	key: `double`,
	do: (_, amount) => amount * 2,
})
