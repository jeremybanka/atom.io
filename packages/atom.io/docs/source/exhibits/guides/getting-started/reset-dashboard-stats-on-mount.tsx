import { atom, type Loadable, resetState } from "atom.io"
import * as React from "react"

type DashboardStats = {
	openTicketCount: number
	overdueTicketCount: number
	medianResponseTime: string
}

const dashboardStatsAtom = atom<Loadable<DashboardStats>, Error>({
	key: `dashboardStats`,
	default: async () => {
		await Promise.resolve()
		return {
			openTicketCount: 0,
			overdueTicketCount: 0,
			medianResponseTime: `--`,
		}
	},
	catch: [Error],
})

export function DashboardSummary(): React.JSX.Element {
	// @exhibit-region start reset-dashboard-stats-on-mount
	React.useEffect(() => {
		resetState(dashboardStatsAtom) // ❌ do not reset on mount; duplicates async work
	}, [])
	// @exhibit-region end reset-dashboard-stats-on-mount

	return <section>Support dashboard</section>
}
