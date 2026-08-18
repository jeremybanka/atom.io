import type { Json } from "atom.io/foundations/json"
import type {
	MosaicDomainIdentity,
	MosaicDomainMemberAddress,
} from "atom.io/realtime"
import {
	createMosaicDomainCheckpointCoordinator,
	InMemoryMosaicDomainCheckpointStorage,
} from "atom.io/realtime-server"

declare const domain: MosaicDomainIdentity
declare function readMemberAtRevision(context: {
	address: MosaicDomainMemberAddress
	revision: number
}): Promise<Json.Serializable>

const storage = new InMemoryMosaicDomainCheckpointStorage()
const checkpoints = createMosaicDomainCheckpointCoordinator({
	domain,
	indexes: ({ batches, revision }) =>
		batches.flatMap(({ batch }) =>
			batch.affectedMembers.map((address) => ({
				index: `changed-members`,
				path: `${address.member}/${JSON.stringify(address.key ?? null)}`,
				value: revision,
			})),
		),
	readMember: readMemberAtRevision,
	storage,
})

const published = await checkpoints.checkpoint()
const view = await checkpoints.recover([
	{
		domain,
		key: `shape-7`,
		member: `shapes`,
	},
])

await storage.upsertCheckpointRetentionLease(domain, {
	id: `tab-1-outbox`,
	kind: `outbox`,
	minimumRevision: view.root.revision,
	rootKeys: [published.rootKey],
})
