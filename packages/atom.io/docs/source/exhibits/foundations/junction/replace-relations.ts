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

credits.replaceRelations(`rumours`, {
	"fleetwood-mac": { role: `band` },
	"ken-caillat": { role: `producer` },
})
