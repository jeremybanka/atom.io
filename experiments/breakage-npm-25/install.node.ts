import { execFileSync } from "node:child_process"

const stage = process.argv[2] === `stage`
const args = stage
	? [
			`--ignore-workspace`,
			`--config.autoInstallPeers=false`,
			`--config.strictPeerDependencies=false`,
			`install`,
			`--ignore-scripts`,
			`--no-lockfile`,
		]
	: [`install`, `--ignore-scripts`, `--frozen-lockfile`]
if (process.argv[2] === `initialize`)
	args[args.indexOf(`--frozen-lockfile`)] = `--no-frozen-lockfile`

// Optional cache controls; ordinary runs use pnpm's normal store and network.
if (process.env[`ATOM_IO_PEER_OFFLINE`] === `1`) args.push(`--offline`)
if (process.env[`ATOM_IO_PEER_STORE`])
	args.push(`--store-dir`, process.env[`ATOM_IO_PEER_STORE`]!)
execFileSync(`pnpm`, args, { stdio: `inherit` })
