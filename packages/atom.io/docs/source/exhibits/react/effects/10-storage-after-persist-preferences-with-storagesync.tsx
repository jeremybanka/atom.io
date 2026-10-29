import { useI, useO } from "@atom.io/react"
import { atom } from "atom.io"
import { storageSync } from "atom.io/web"

import { PreferenceToggle } from "./views.tsx"

// Render this preference behind the client-only boundary in the client-only content example.
const collapsedAtom = atom<boolean>({
	key: `collapsed`,
	default: false,
	effects: [
		storageSync(
			typeof window === `undefined` ? undefined : localStorage,
			{
				parse: (value) => value === `true`,
				stringify: String,
			},
			`sidebarCollapsed`,
		),
	],
})
export function SidebarPreference() {
	const collapsed = useO(collapsedAtom)
	const setCollapsed = useI(collapsedAtom)
	return <PreferenceToggle checked={collapsed} onChange={setCollapsed} />
}
