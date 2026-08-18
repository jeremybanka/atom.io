import type {
	MosaicDomainBatchEnvelope,
	MosaicDomainBatchProposal,
} from "atom.io/realtime"

import type {
	MosaicDomainBatchProposalResult,
	MosaicDomainBatchServer,
} from "./mosaic-domain-batch-server.ts"

type HistoryBatchProposer = (
	identity: { readonly actor: string; readonly session: string },
	proposal: MosaicDomainBatchProposal,
	validate: (
		batch: MosaicDomainBatchEnvelope,
		revision: number,
	) => Promise<void> | void,
) => Promise<MosaicDomainBatchProposalResult>

const historyBatchProposers = new WeakMap<
	MosaicDomainBatchServer,
	HistoryBatchProposer
>()

export function registerMosaicDomainHistoryBatchProposer(
	server: MosaicDomainBatchServer,
	propose: HistoryBatchProposer,
): void {
	historyBatchProposers.set(server, propose)
}

/** Submit compensation through the server-private history capability. */
export function proposeMosaicDomainHistoryBatch(
	server: MosaicDomainBatchServer,
	identity: { readonly actor: string; readonly session: string },
	proposal: MosaicDomainBatchProposal,
	validate: (
		batch: MosaicDomainBatchEnvelope,
		revision: number,
	) => Promise<void> | void,
): Promise<MosaicDomainBatchProposalResult> {
	const propose = historyBatchProposers.get(server)
	if (propose === undefined) {
		throw new Error(`A Mosaic Domain history proposal capability is invalid.`)
	}
	return propose(identity, proposal, validate)
}
