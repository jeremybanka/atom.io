import type {
	PgBuildColumns,
	PgEnum,
	PgEnumColumnBuilder,
	PgIntegerBuilder,
	PgSerialBuilder,
	PgTableWithColumns,
	PgVarcharBuilder,
	SetIsPrimaryKey,
} from "drizzle-orm/pg-core"
import {
	integer,
	pgEnum,
	pgTable,
	serial,
	uniqueIndex,
	varchar,
} from "drizzle-orm/pg-core"

export const popularityEnum: PgEnum<[`unknown`, `known`, `popular`]> = pgEnum(
	`popularity`,
	[`unknown`, `known`, `popular`],
)

export const countries: PgTableWithColumns<{
	name: `countries`
	schema: undefined
	columns: PgBuildColumns<
		`countries`,
		{
			id: SetIsPrimaryKey<PgSerialBuilder>
			name: PgVarcharBuilder
		}
	>
	dialect: `pg`
}> = pgTable(
	`countries`,
	{
		id: serial(`id`).primaryKey(),
		name: varchar(`name`, { length: 256 }),
	},
	(col) => [uniqueIndex(`name_idx`).on(col.name)],
)

export const cities: PgTableWithColumns<{
	name: `cities`
	schema: undefined
	columns: PgBuildColumns<
		`cities`,
		{
			id: SetIsPrimaryKey<PgSerialBuilder>
			name: PgVarcharBuilder
			countryId: PgIntegerBuilder
			popularity: PgEnumColumnBuilder<[`unknown`, `known`, `popular`]>
		}
	>
	dialect: `pg`
}> = pgTable(`cities`, {
	id: serial(`id`).primaryKey(),
	name: varchar(`name`, { length: 256 }),
	countryId: integer(`country_id`).references(() => countries.id),
	popularity: popularityEnum(`popularity`),
})
