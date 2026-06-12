import type { Store } from "./store/index.ts"

export type EnvironmentData = {
	store: Store
}

export function getEnvironmentData(store: Store): EnvironmentData {
	return {
		store,
	}
}
