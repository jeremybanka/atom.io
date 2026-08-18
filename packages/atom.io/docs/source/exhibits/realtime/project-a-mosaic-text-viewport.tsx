import type {
	MosaicDomainIdentity,
	MosaicDomainMemberAddress,
} from "atom.io/realtime"
import type {
	MosaicDomainResidencyClient,
	MosaicTextProjectionClientOptions,
} from "atom.io/realtime-client"
import { createMosaicTextProjectionClient } from "atom.io/realtime-client"
import { useMosaicTextRange } from "atom.io/realtime-react"

type Identity = MosaicDomainIdentity
type TextAdapter = Pick<
	MosaicTextProjectionClientOptions<Identity>,
	`materialize` | `planEdit` | `positionAtOffset` | `resolvePosition`
>

declare const residency: MosaicDomainResidencyClient<Identity>
declare const rootAddress: MosaicDomainMemberAddress<Identity>
declare const textAdapter: TextAdapter

const text = createMosaicTextProjectionClient({
	actor: `ada`,
	domainKey: `handbook-body`,
	evictReleased: true,
	maximumActiveRanges: 12,
	maximumRangeUtf16Units: 16_384,
	...textAdapter,
	rangeMember: `indexMembers`,
	rangeMemberLimit: 64,
	residency,
	rootAddress,
	session: `tab-1`,
})

export function TextViewport(props: {
	readonly end: number
	readonly start: number
}) {
	const view = useMosaicTextRange(
		text,
		{ end: props.end, kind: `utf16-range`, start: props.start },
		{ overscan: 2_048 },
	)
	if (view.status === `loading`) return <p>Loading text…</p>
	if (view.status === `error`) return <p>Unable to load this range.</p>
	return (
		<article>
			{view.projection.blocks.map((block) => (
				<p key={block.key}>{block.text}</p>
			))}
		</article>
	)
}

// The application adapter turns one logical gesture into one Domain batch.
await text.edit({
	anchor: await text.positionAtOffset(5),
	head: await text.positionAtOffset(11),
	text: `bounded`,
	type: `replace`,
})

// Full materialization remains explicit, so a viewport cannot request it by accident.
const completeDocument = await text.materialize()
void completeDocument
