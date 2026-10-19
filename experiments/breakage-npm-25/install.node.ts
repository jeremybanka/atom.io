import { execFile } from "node:child_process"
import {
	chmod,
	copyFile,
	lstat,
	readdir,
	realpath,
	rename,
	stat,
} from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"

const execute = promisify(execFile)
const store =
	process.env[`ATOM_IO_PEER_STORE`] ?? `/tmp/atomio-npm25-offline-store`
const stage = process.argv[2] === `stage`
const args = stage
	? [
			`--ignore-workspace`,
			`--config.autoInstallPeers=false`,
			`--config.strictPeerDependencies=false`,
			`install`,
			`--offline`,
			`--ignore-scripts`,
			`--no-lockfile`,
		]
	: [`install`, `--offline`, `--ignore-scripts`, `--frozen-lockfile`]
if (process.argv[2] === `initialize`)
	args[args.indexOf(`--frozen-lockfile`)] = `--no-frozen-lockfile`
try {
	await execute(`pnpm`, [...args, `--store-dir`, store], {
		maxBuffer: 16 * 1024 * 1024,
	})
} catch (error) {
	process.stderr.write(String((error as { stdout?: string }).stdout ?? ``))
	process.stderr.write(String((error as { stderr?: string }).stderr ?? ``))
	throw error
}

// This offline cache reuses immutable files through links. Materialize imported
// file links so Node resolves modules from their installed package directories.
async function materialize(directory: string): Promise<void> {
	for (const name of await readdir(directory)) {
		if (name === `.bin`) continue
		const filename = join(directory, name)
		const entry = await lstat(filename)
		if (entry.isDirectory()) await materialize(filename)
		else if (entry.isSymbolicLink()) {
			const resolved = await realpath(filename)
			if (!resolved.includes(`/store/v11/files/`)) continue
			const source = await stat(filename)
			if (!source.isFile()) continue
			const temporary = `${filename}.npm25-copy`
			await copyFile(filename, temporary)
			await chmod(temporary, source.mode)
			await rename(temporary, filename)
		}
	}
}
await materialize(join(process.cwd(), `node_modules/.pnpm`))
