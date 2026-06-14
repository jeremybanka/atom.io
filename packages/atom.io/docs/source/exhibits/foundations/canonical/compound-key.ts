import {
	type Canonical,
	packCanonical,
	unpackCanonical,
} from "atom.io/foundations/canonical"

type TrackKey = readonly [playlistId: string, trackId: string]

const key = [`road-trip`, `dreams`] as const satisfies Canonical
const packed = packCanonical<TrackKey>(key)
const unpacked = unpackCanonical(packed)
