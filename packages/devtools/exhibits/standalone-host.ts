import {
	serveDevtoolsStore,
	type StandaloneDevtools,
} from "@atom.io/devtools/standalone"
import type { Silo } from "atom.io"

export async function startDevelopmentInspector(
	silo: Silo,
): Promise<StandaloneDevtools | undefined> {
	if (process.env[`NODE_ENV`] !== `development`) return

	const viewer = await serveDevtoolsStore(silo)
	console.error(`Devtools viewer`, viewer.url.href)
	return viewer
}
