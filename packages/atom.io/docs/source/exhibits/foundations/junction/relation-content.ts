import { Junction } from "atom.io/foundations/junction"

const credits = new Junction<
	`album`,
	string,
	`artist`,
	string,
	{ role: string }
>({
	between: [`album`, `artist`],
	cardinality: `n:n`,
})

credits.set({ album: `rumours`, artist: `fleetwood-mac` }, { role: `band` })
credits.getContent(`rumours`, `fleetwood-mac`) // { role: "band" }
