import { Junction } from "atom.io/foundations/junction"

const playlistTracks = new Junction({
	between: [`playlist`, `track`],
	cardinality: `n:n`,
})

playlistTracks.set({ playlist: `road-trip`, track: `dreams` })

playlistTracks.getRelatedKeys(`road-trip`) // Set { "dreams" }
playlistTracks.getRelatedKey(`dreams`) // "road-trip"
