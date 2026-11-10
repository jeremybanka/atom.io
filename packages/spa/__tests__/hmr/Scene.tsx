import type { SpaElement } from "@atom.io/spa"
import { onCleanup, useGetter } from "@atom.io/spa"
import { Group } from "@atom.io/spa/three"
import type { RegularAtomToken } from "atom.io"

import { cleanups } from "./state.ts"

export function Scene(props: { token: RegularAtomToken<number> }): SpaElement {
	const getCount = useGetter(props.token)
	onCleanup(() => {
		cleanups.scene++
	})
	return <Group position={[getCount(), 0, 0]} />
}
