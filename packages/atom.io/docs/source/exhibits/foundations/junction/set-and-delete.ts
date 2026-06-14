import { Junction } from "atom.io/foundations/junction"

const playlistTracks = new Junction({
	between: [`playlist`, `track`],
	cardinality: `n:n`,
})

playlistTracks.set(`road-trip`, `dreams`)
playlistTracks.set({ playlist: `road-trip`, track: `ventura-highway` })

playlistTracks.delete({ playlist: `road-trip`, track: `dreams` })
playlistTracks.delete({ playlist: `road-trip` })
