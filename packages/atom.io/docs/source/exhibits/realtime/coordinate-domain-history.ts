import type { Json } from "atom.io/foundations/json"
import type { MosaicDomainMemberAddress } from "atom.io/realtime"
import {
	createMosaicDomainBatchServer,
	createMosaicDomainCheckpointCoordinator,
	createMosaicDomainHistoryCoordinator,
	InMemoryMosaicDomainCheckpointStorage,
} from "atom.io/realtime-server"

declare const domain: Parameters<
	typeof createMosaicDomainBatchServer
>[0][`domain`]

const storage = new InMemoryMosaicDomainCheckpointStorage({
	maxRecentReceipts: 1_024,
	maxSessionWatermarks: 1_024,
})
const batches = createMosaicDomainBatchServer({ domain, storage })
const history = createMosaicDomainHistoryCoordinator({
	batches,
	domain,
	limits: { undoStepsPerActor: 100 },
	storage,
})

const checkpoints = createMosaicDomainCheckpointCoordinator({
	domain: domain.identity,
	indexes: history.checkpoint.indexes,
	readMember: async ({ address, revision }) =>
		history.checkpoint.compactMember({
			address,
			revision,
			value: await readMemberAtRevision(address, revision),
		}),
	storage,
})

declare function readMemberAtRevision(
	address: MosaicDomainMemberAddress,
	revision: number,
): Promise<Json.Serializable>

await history.protect({
	id: `ada:presence-anchor`,
	kind: `presence`,
	minimumRevision: batches.revision,
	operationIds: [`ada:pending-anchor-operation`],
})
await checkpoints.checkpoint()
await history.releaseProtection(`ada:presence-anchor`)

const tab = history.connect({ actor: `ada`, session: `tab-1` })
const before = await tab.snapshot()
if (before.horizon.canUndo) {
	await tab.request({
		cursor: before.cursor,
		id: `ada:tab-1:history:1`,
		mode: `undo`,
		sequence: 1,
		session: `tab-1`,
	})
}
