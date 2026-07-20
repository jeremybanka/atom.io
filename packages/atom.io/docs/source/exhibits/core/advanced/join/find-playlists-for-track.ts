import { findRelations } from "atom.io"

import { playlistTracks } from "./declare-playlist-tracks.ts"

const playlistsUsingDreamsState = findRelations(
	playlistTracks,
	`track:dreams`,
).playlistKeysOfTrack
