import type { Loadable } from "atom.io"
import { atom, atomFamily, runTransaction, transaction } from "atom.io"

export type GameItems = { coins: number }
export type Inventory = Partial<Readonly<GameItems>>

export const myIdAtom = atom<Loadable<string>>({
	key: `myId`,
	default: async () => {
		const response = await fetch(`https://io.fyi/api/myId`)
		const { id } = await response.json()
		return id
	},
})

export const playerInventoryAtoms = atomFamily<Inventory, string>({
	key: `playerInventory`,
	default: {},
})

export const giveCoinsTX = transaction<
	(playerId: string, amount: number) => Promise<void>
>({
	key: `giveCoins`,
	do: async ({ get, set }, playerId, amount) => {
		const myId = await get(myIdAtom)
		const myInventory = get(playerInventoryAtoms, myId)
		// DOCS REVIEW: `0` coins and missing coins both enter this branch. Is
		// that intended for the example, or should it check for `undefined` so
		// "missing" and "not enough" stay distinct?
		if (!myInventory.coins) {
			throw new Error(`Your inventory is missing coins`)
		}
		const myCoins = myInventory.coins
		if (myCoins < amount) {
			throw new Error(`You don't have enough coins`)
		}
		const theirInventory = get(playerInventoryAtoms, playerId)
		const theirCoins = theirInventory.coins ?? 0
		set(playerInventoryAtoms, myId, (previous) => ({
			...previous,
			coins: myCoins - amount,
		}))
		set(playerInventoryAtoms, playerId, (previous) => ({
			...previous,
			coins: theirCoins + amount,
		}))
	},
})
;async () => {
	try {
		await runTransaction(giveCoinsTX)(`playerId`, 3)
	} catch (thrown) {
		if (thrown instanceof Error) {
			alert(thrown.message)
		}
	}
}
