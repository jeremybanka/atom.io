import { spawn } from "node:child_process"

import { DatabaseManager } from "../__tests__/private/experiments/stateless/database.node.ts"

const [command, ...args] = process.argv.slice(2)
if (!command) throw new Error(`Expected a command to run with the test schema`)

// Reylo needs the schema before TypeScript or Vite loads SQL imports. Use the
// same table definitions as the tests, in a separate disposable database.
const database = new DatabaseManager()
try {
	await database.createDatabase()
	await database.createSampleTables()
	const env = database.env
	const url = new URL(`postgresql://127.0.0.1`)
	url.username = env[`PGUSER`] ?? ``
	url.hostname = env[`PGHOST`] ?? ``
	url.port = env[`PGPORT`] ?? ``
	url.pathname = env[`PGDATABASE`] ?? ``
	const child = spawn(command, args, {
		env: { ...process.env, ATOM_IO_REYLO_DATABASE_URL: url.href },
		stdio: `inherit`,
	})
	const onInterrupt = () => {
		child.kill(`SIGINT`)
	}
	const onTerminate = () => {
		child.kill(`SIGTERM`)
	}
	process.on(`SIGINT`, onInterrupt)
	process.on(`SIGTERM`, onTerminate)
	try {
		process.exitCode = await new Promise<number>((resolve, reject) => {
			child.once(`error`, reject)
			child.once(`exit`, (code, signal) => {
				resolve(code ?? (signal === `SIGINT` ? 130 : 143))
			})
		})
	} finally {
		process.off(`SIGINT`, onInterrupt)
		process.off(`SIGTERM`, onTerminate)
	}
} finally {
	await database.dropDatabase()
}
