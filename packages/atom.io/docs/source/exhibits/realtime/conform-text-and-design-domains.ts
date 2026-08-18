import {
	type MosaicDomainConformanceAdapter,
	testMosaicDomainConformance,
} from "atom.io/realtime-testing"

declare const longFormText: MosaicDomainConformanceAdapter
declare const vectorDesign: MosaicDomainConformanceAdapter

const verticals = [longFormText, vectorDesign] as const
const reports = await Promise.all(
	verticals.map((vertical) => testMosaicDomainConformance(vertical)),
)

const [sharedSchedule] = reports.map((report) => report.schedule.join(`,`))
if (reports.some((report) => report.schedule.join(`,`) !== sharedSchedule)) {
	throw new Error(`The verticals did not exercise the same fault schedule.`)
}

for (const { counters, domain, name } of reports) {
	console.table({
		checkpointWrites: counters.checkpointWrites,
		deliveredPayloads: counters.deliveredPayloads,
		domain,
		name,
		residentMembers: counters.residentMembers,
		retainedHistory: counters.retainedHistory,
		selectorInvalidations: counters.selectorInvalidations,
	})
}
