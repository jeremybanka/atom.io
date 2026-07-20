import { editRelations } from "atom.io"

import { playlistTracks } from "./declare-playlist-tracks.ts"

editRelations(playlistTracks, (relations) => {
	relations.replaceRelations(`playlist:road-trip`, [
		`track:dreams`,
		`track:landslide`,
		`track:rhiannon`,
	])
})
