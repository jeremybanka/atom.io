/** @jsxImportSource react */
import { lazy, type ReactElement, Suspense } from "react"

const DevtoolsPanel = import.meta.env.DEV
	? lazy(() => import(`./development-react-panel.ts`))
	: null

export function DevelopmentDevtools(): ReactElement | null {
	if (!DevtoolsPanel) return null
	return (
		<Suspense fallback={null}>
			<DevtoolsPanel />
		</Suspense>
	)
}
