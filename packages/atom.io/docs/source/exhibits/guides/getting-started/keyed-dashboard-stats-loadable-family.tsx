import { atomFamily, type Loadable } from "atom.io"
import { useLoadable } from "atom.io/react"

type DashboardId = `dashboard:${string}`

type DashboardStats = {
	openTicketCount: number
	overdueTicketCount: number
	medianResponseTime: string
}

const EMPTY_DASHBOARD_STATS: DashboardStats = {
	openTicketCount: 0,
	overdueTicketCount: 0,
	medianResponseTime: `--`,
}

async function fetchDashboardStats(
	dashboardId: DashboardId,
): Promise<DashboardStats> {
	const id = dashboardId.slice(`dashboard:`.length)
	const response = await fetch(`/api/dashboards/${id}/stats`)
	if (!response.ok) {
		throw new Error(`Could not load dashboard stats.`)
	}
	return response.json()
}

// @exhibit-region start keyed-dashboard-stats-loadable-family
const dashboardStatsAtoms = atomFamily<
	Loadable<DashboardStats>,
	DashboardId,
	Error
>({
	key: `dashboardStats`,
	default: fetchDashboardStats,
	catch: [Error],
})

function DashboardSummary({ dashboardId }: { dashboardId: DashboardId }) {
	const stats = useLoadable(
		dashboardStatsAtoms,
		dashboardId,
		EMPTY_DASHBOARD_STATS,
	)

	return <p>{stats.value.openTicketCount} open tickets</p>
}
// @exhibit-region end keyed-dashboard-stats-loadable-family

export const dashboardSummary = (
	<DashboardSummary dashboardId="dashboard:support" />
)
