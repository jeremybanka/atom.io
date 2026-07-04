import { Junction } from "atom.io/foundations/junction"

type PlaylistKey = `playlist::${string}`
type TrackKey = `track::${string}`

const playlistTracks = new Junction<`playlist`, PlaylistKey, `track`, TrackKey>({
	between: [`playlist`, `track`],
	cardinality: `n:n`,
})

playlistTracks.set({
	playlist: `playlist::road-trip`,
	track: `track::dreams`,
})

playlistTracks.getRelatedKeys(`playlist::road-trip`) // Set { "track::dreams" }
playlistTracks.getRelatedKey(`track::dreams`) // "playlist::road-trip"
