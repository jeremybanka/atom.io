import type { Json } from "atom.io/foundations/json"
import { become } from "atom.io/internal"

import type { SetterOrUpdater } from "../../index.ts"

export const makeElementSetters = <T extends Json.Tree.Array>(
	data: T,
	set: SetterOrUpdater<T>,
): SetterOrUpdater<T[number]>[] =>
	data.map((value, index) => (newValue) => {
		set((): T => {
			const newData = [...data]
			newData[index] = become(newValue, value)
			return newData as unknown as T
		})
	})
