import type {
	Loadable,
	ReadonlySelectorToken,
	RegularAtomFamilyToken,
	RegularAtomToken,
} from "atom.io"
import { Silo } from "atom.io"
import type postgres from "postgres"

export type Country = { id: number; name: string | null }
export type CountryDirectory = {
	silo: Silo
	countryAtoms: RegularAtomFamilyToken<Loadable<Country | null>, number>
	countriesAtom: RegularAtomToken<Loadable<Country[]>>
	countryNamesSelector: ReadonlySelectorToken<Loadable<string>>
	close: () => Promise<void>
}

// An application-level example, not a published database adapter. Each caller
// owns its SQL client and gets an independent store and LISTEN subscription.
export async function connectCountryDirectory(
	reader: ReturnType<typeof postgres>,
	name: string,
): Promise<CountryDirectory> {
	const silo = new Silo({ name, lifespan: `ephemeral`, isProduction: false })
	const refreshRows = new Map<number, () => void>()
	const countryAtoms = silo.atomFamily<Loadable<Country | null>, number>({
		key: `country`,
		default: async (id) => {
			const rows = await reader<Country[]>`
				SELECT id, name FROM countries WHERE id = ${id}
			`
			return rows[0] ?? null
		},
		effects: (id) => [
			({ resetSelf }) => {
				refreshRows.set(id, resetSelf)
				return () => {
					refreshRows.delete(id)
				}
			},
		],
	})
	const countriesAtom = silo.atom<Loadable<Country[]>>({
		key: `countries`,
		default: async () => {
			const rows = await reader<Country[]>`
				SELECT id, name FROM countries ORDER BY id
			`
			return [...rows]
		},
	})
	const countryNamesSelector = silo.selector<Loadable<string>>({
		key: `countryNames`,
		get: async ({ get }) => {
			const countries = await get(countriesAtom)
			return countries.map((country) => country.name ?? `Unnamed`).join(`, `)
		},
	})

	// Subscribe before initial reads so a commit cannot fall into a gap between
	// loading the snapshot and registering LISTEN. Payloads invalidate queries;
	// the database remains the source of truth, including for deleted rows.
	const listener = await reader.listen(`table_update`, (message) => {
		const [table, rowId] = message.split(`,`)
		if (table !== `countries`) return
		const id = Number(rowId)
		if (!Number.isSafeInteger(id) || id <= 0) return
		refreshRows.get(id)?.()
		silo.resetState(countriesAtom)
	})

	return {
		silo,
		countryAtoms,
		countriesAtom,
		countryNamesSelector,
		// UNLISTEN is awaited before callers close their SQL client. Notifications
		// are transient; a newly connected directory reads a fresh snapshot.
		close: (): Promise<void> => listener.unlisten(),
	}
}
