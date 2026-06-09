import type { ChildProcessByStdio } from "node:child_process"
import { spawn, spawnSync } from "node:child_process"
import * as fs from "node:fs/promises"
import * as net from "node:net"
import * as os from "node:os"
import * as path from "node:path"
import type { Readable } from "node:stream"

const POSTGRES_USER = `postgres`
const POSTGRES_HOST = `127.0.0.1`
const POSTGRES_READY_LOG = `database system is ready to accept connections`
const STARTUP_TIMEOUT_MS = 10_000
const SHUTDOWN_TIMEOUT_MS = 5_000
let commandEnv: NodeJS.ProcessEnv | undefined
type PostgresProcess = ChildProcessByStdio<null, Readable, Readable>

export type LocalPostgres = {
	host: string
	port: number
	user: string
	env: Record<string, string>
	stop: () => Promise<void>
}

export async function startLocalPostgres(): Promise<LocalPostgres> {
	const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), `atom-io-pg-data-`))
	const socketDir = await fs.mkdtemp(
		path.join(os.tmpdir(), `atom-io-pg-socket-`),
	)
	const port = await getAvailablePort()

	try {
		await runCommand(`initdb`, [
			`--pgdata=${dataDir}`,
			`--auth=trust`,
			`--username=${POSTGRES_USER}`,
		])
	} catch (error) {
		await removeClusterDirectories(dataDir, socketDir)
		throw error
	}

	const proc = spawn(
		`postgres`,
		[
			`-D`,
			dataDir,
			`-p`,
			port.toString(),
			`-k`,
			socketDir,
			`-h`,
			POSTGRES_HOST,
			`-c`,
			`fsync=off`,
			`-c`,
			`synchronous_commit=off`,
			`-c`,
			`full_page_writes=off`,
		],
		{
			env: getPostgresCommandEnv(),
			stdio: [`ignore`, `pipe`, `pipe`],
		},
	)

	let stopped = false
	const stop = async (): Promise<void> => {
		if (stopped) return
		stopped = true
		await stopPostgres(proc)
		await removeClusterDirectories(dataDir, socketDir)
	}

	try {
		await waitForPostgres(proc)
		proc.stdout.resume()
		proc.stderr.resume()
	} catch (error) {
		await stop()
		throw error
	}

	return {
		host: POSTGRES_HOST,
		port,
		user: POSTGRES_USER,
		env: {
			PGHOST: POSTGRES_HOST,
			PGPORT: port.toString(),
			PGUSER: POSTGRES_USER,
		},
		stop,
	}
}

function getAvailablePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = net.createServer()
		server.unref()
		server.on(`error`, reject)
		server.listen(0, POSTGRES_HOST, () => {
			const address = server.address()
			if (address === null || typeof address === `string`) {
				server.close()
				reject(new Error(`Unable to reserve a test Postgres port`))
				return
			}
			const { port } = address
			server.close((error) => {
				if (error) {
					reject(error)
				} else {
					resolve(port)
				}
			})
		})
	})
}

function runCommand(command: string, args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const proc = spawn(command, args, {
			env: getPostgresCommandEnv(),
			stdio: [`ignore`, `pipe`, `pipe`],
		})
		let stdout = ``
		let stderr = ``

		proc.stdout.on(`data`, (chunk) => {
			stdout += chunk.toString()
		})
		proc.stderr.on(`data`, (chunk) => {
			stderr += chunk.toString()
		})
		proc.on(`error`, (error) => {
			if (`code` in error && error.code === `ENOENT`) {
				reject(
					new Error(
						`${command} was not found. Run \`mise install\` so the Postgres test harness can start its local database.`,
					),
				)
				return
			}
			reject(error)
		})
		proc.on(`close`, (code, signal) => {
			if (code === 0) {
				resolve()
				return
			}
			reject(
				new Error(
					[
						`${command} ${args.join(` `)} failed with ${signal ?? `code ${code}`}.`,
						stdout.trim(),
						stderr.trim(),
					]
						.filter(Boolean)
						.join(`\n`),
				),
			)
		})
	})
}

function getPostgresCommandEnv(): NodeJS.ProcessEnv {
	if (commandEnv !== undefined) return commandEnv
	commandEnv = { ...process.env, ...readMiseEnv() }
	delete commandEnv[`PGDATA`]
	return commandEnv
}

function readMiseEnv(): Record<string, string> {
	if (process.env[`ATOM_IO_TEST_POSTGRES_SKIP_MISE`] === `true`) return {}
	const result = spawnSync(`mise`, [`env`, `--json`], {
		encoding: `utf8`,
		stdio: [`ignore`, `pipe`, `ignore`],
	})
	if (result.status !== 0) return {}
	try {
		const parsed: unknown = JSON.parse(result.stdout)
		if (typeof parsed !== `object` || parsed === null) return {}
		const env: Record<string, string> = {}
		for (const [key, value] of Object.entries(parsed)) {
			if (typeof value === `string`) env[key] = value
		}
		return env
	} catch {
		return {}
	}
}

function waitForPostgres(proc: PostgresProcess): Promise<void> {
	let log = ``
	return new Promise((resolve, reject) => {
		let settled = false

		const finish = (callback: () => void) => {
			if (settled) return
			settled = true
			clearTimeout(timeout)
			proc.stdout.off(`data`, onData)
			proc.stderr.off(`data`, onData)
			proc.off(`error`, onError)
			proc.off(`exit`, onExit)
			callback()
		}
		const onData = (chunk: Buffer) => {
			log += chunk.toString()
			if (log.includes(POSTGRES_READY_LOG)) {
				finish(resolve)
			}
		}
		const onError = (error: Error) => {
			finish(() => {
				reject(error)
			})
		}
		const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
			finish(() => {
				reject(
					new Error(
						[
							`postgres exited before accepting connections (${signal ?? `code ${code}`}).`,
							log.trim(),
						]
							.filter(Boolean)
							.join(`\n`),
					),
				)
			})
		}
		const timeout = setTimeout(() => {
			finish(() => {
				reject(
					new Error(
						[
							`Timed out waiting for test Postgres to start on ${POSTGRES_HOST}.`,
							log.trim(),
						]
							.filter(Boolean)
							.join(`\n`),
					),
				)
			})
		}, STARTUP_TIMEOUT_MS)

		proc.stdout.on(`data`, onData)
		proc.stderr.on(`data`, onData)
		proc.on(`error`, onError)
		proc.on(`exit`, onExit)
	})
}

async function stopPostgres(proc: PostgresProcess): Promise<void> {
	if (proc.exitCode !== null || proc.signalCode !== null) return

	proc.kill(`SIGTERM`)
	try {
		await waitForExit(proc, SHUTDOWN_TIMEOUT_MS)
	} catch {
		proc.kill(`SIGKILL`)
		await waitForExit(proc, SHUTDOWN_TIMEOUT_MS)
	}
}

function waitForExit(proc: PostgresProcess, timeoutMs: number): Promise<void> {
	return new Promise((resolve, reject) => {
		if (proc.exitCode !== null || proc.signalCode !== null) {
			resolve()
			return
		}

		const finish = (callback: () => void) => {
			clearTimeout(timeout)
			proc.off(`exit`, onExit)
			callback()
		}
		const onExit = () => {
			finish(resolve)
		}
		const timeout = setTimeout(() => {
			finish(() => {
				reject(new Error(`Timed out waiting for postgres to stop`))
			})
		}, timeoutMs)

		proc.on(`exit`, onExit)
	})
}

async function removeClusterDirectories(
	dataDir: string,
	socketDir: string,
): Promise<void> {
	await Promise.all([
		fs.rm(dataDir, { force: true, recursive: true }),
		fs.rm(socketDir, { force: true, recursive: true }),
	])
}
