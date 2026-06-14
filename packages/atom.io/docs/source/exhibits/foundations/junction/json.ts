import { Junction } from "atom.io/foundations/junction"

const playlistTracks = new Junction({
	between: [`playlist`, `track`],
	cardinality: `n:n`,
})

playlistTracks.set({ playlist: `road-trip`, track: `dreams` })

const json = playlistTracks.toJSON()
const restored = new Junction(json)
