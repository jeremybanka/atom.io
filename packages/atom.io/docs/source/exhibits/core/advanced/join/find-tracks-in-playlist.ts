import { findRelations } from "atom.io"

import { playlistTracks } from "./declare-playlist-tracks.ts"

const tracksInRoadTripState = findRelations(
	playlistTracks,
	`playlist::road-trip`,
).trackKeysOfPlaylist
