import type { ReactNode } from "react"
import { useEffect, useState } from "react"

import { PreferenceToggle } from "./views.tsx"

// Client-only preference UI; see the client-only content example for hydration.
export function SidebarPreference(): ReactNode {
	const [collapsed, setCollapsed] = useState(
		() => localStorage.getItem(`sidebarCollapsed`) === `true`,
	)
	useEffect(() => {
		localStorage.setItem(`sidebarCollapsed`, String(collapsed))
	}, [collapsed])
	return <PreferenceToggle checked={collapsed} onChange={setCollapsed} />
}
