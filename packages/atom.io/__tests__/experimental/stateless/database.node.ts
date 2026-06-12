import * as path from "node:path"

import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import { type LocalPostgres, startLocalPostgres } from "../postgres.node.ts"
import { cities, countries } from "./schema.node.ts"

type DatabaseConfig = {
	database: string
	host: string
	port: number
	user: string
}
type PostgresSql = ReturnType<typeof postgres>
type DrizzleDb = ReturnType<typeof drizzle>

export class DatabaseManager {
	public dbName: string = `test_db_${process.pid}_${Date.now()}`
	private localPostgres: LocalPostgres | undefined
	private config: DatabaseConfig | undefined
	private sql: PostgresSql | undefined
	private drizzle: DrizzleDb | undefined

	public get env(): Record<string, string> {
		if (this.localPostgres === undefined) {
			throw new Error(`Cannot read Postgres env before createDatabase()`)
		}
		return {
			...this.localPostgres.env,
			DB_HOST: this.localPostgres.host,
			DB_NAME: this.dbName,
			DB_PORT: this.localPostgres.port.toString(),
			DB_USER: this.localPostgres.user,
			PGDATABASE: this.dbName,
		}
	}

	public async createDatabase(): Promise<void> {
		await this.startPostgres()
		const sql = this.getSql()
		await sql`CREATE DATABASE ${sql(this.dbName)}`
		await sql.end()
		if (this.config === undefined) {
			throw new Error(`Postgres config was not initialized`)
		}
		this.config = { ...this.config, database: this.dbName }
		this.sql = postgres(this.config)
		this.drizzle = drizzle(this.sql)
	}

	public async setupTriggersAndNotifications(): Promise<void> {
		await this.getSql().file(path.join(__dirname, `notify_update.sql`))
	}

	public async dropDatabase(): Promise<void> {
		if (this.localPostgres === undefined) return
		const { localPostgres } = this
		try {
			await this.sql?.end()
			if (this.config !== undefined) {
				const adminSql = postgres({ ...this.config, database: `postgres` })
				try {
					await adminSql`DROP DATABASE IF EXISTS ${adminSql(
						this.dbName,
					)} WITH (FORCE)`
				} finally {
					await adminSql.end()
				}
			}
		} finally {
			this.localPostgres = undefined
			this.config = undefined
			this.sql = undefined
			this.drizzle = undefined
			await localPostgres.stop()
		}
	}

	public async createSampleTables(): Promise<void> {
		await this.getSql()`
		  CREATE TABLE countries (
				id SERIAL PRIMARY KEY,
				name TEXT
		  );
		`
		await this.getSql()`
		  CREATE TYPE popularity AS ENUM (
				'unknown',
				'known',
				'popular'
		  );
		`
		await this.getSql()`
		  CREATE TABLE cities (
				id SERIAL PRIMARY KEY,
				name TEXT,
				country_id INTEGER REFERENCES countries(id),
				popularity popularity
		  );
		`
	}

	public async insertSampleData(): Promise<void> {
		await this.getDrizzle()
			.insert(countries)
			.values([{ name: `USA` }, { name: `Canada` }, { name: `Mexico` }])
		await this.getDrizzle()
			.insert(cities)
			.values([
				{ name: `New York`, countryId: 1, popularity: `popular` },
				{ name: `Los Angeles`, countryId: 1, popularity: `popular` },
				{ name: `Chicago`, countryId: 1, popularity: `known` },
				{ name: `Toronto`, countryId: 2, popularity: `known` },
				{ name: `Montreal`, countryId: 2, popularity: `known` },
				{ name: `Vancouver`, countryId: 2, popularity: `known` },
				{ name: `Mexico City`, countryId: 3, popularity: `popular` },
				{ name: `Guadalajara`, countryId: 3, popularity: `known` },
				{ name: `Monterrey`, countryId: 3, popularity: `known` },
			])
	}

	public async dropSampleTables(): Promise<void> {
		await this.getSql()`DROP TABLE IF EXISTS cities`
		await this.getSql()`DROP TYPE IF EXISTS popularity`
		await this.getSql()`DROP TABLE IF EXISTS countries`
	}

	private async startPostgres(): Promise<void> {
		if (this.localPostgres !== undefined) return
		this.localPostgres = await startLocalPostgres()
		this.config = {
			database: `postgres`,
			host: this.localPostgres.host,
			port: this.localPostgres.port,
			user: this.localPostgres.user,
		}
		this.sql = postgres(this.config)
	}

	private getSql(): PostgresSql {
		if (this.sql === undefined) {
			throw new Error(`Database has not been created`)
		}
		return this.sql
	}

	private getDrizzle(): DrizzleDb {
		if (this.drizzle === undefined) {
			throw new Error(`Database has not been created`)
		}
		return this.drizzle
	}
}
