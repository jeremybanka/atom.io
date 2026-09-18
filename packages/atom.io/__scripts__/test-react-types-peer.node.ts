import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

type PackageManifest = {
	devDependencies: Record<string, string>
	peerDependencies: Record<string, string>
	peerDependenciesMeta: Record<string, { optional?: boolean }>
}

const packageRoot = resolve(import.meta.dirname, `..`)
const manifest = JSON.parse(
	await readFile(join(packageRoot, `package.json`), `utf8`),
) as PackageManifest
const workspaceRoot = resolve(packageRoot, `../..`)
const workspaceManifest = JSON.parse(
	await readFile(join(workspaceRoot, `package.json`), `utf8`),
) as { packageManager: string }
// Keep the fixture outside the repo so ancestor node_modules cannot supply React types.
const fixtureRoot = await mkdtemp(join(tmpdir(), `atom-io-react-types-peer-`))

function pnpm(cwd: string, ...args: string[]): void {
	execFileSync(`pnpm`, args, {
		cwd,
		stdio: `inherit`,
		timeout: 120_000,
	})
}

async function writeJson(path: string, value: unknown): Promise<void> {
	await writeFile(path, JSON.stringify(value, null, 2))
}

try {
	const tarball = join(fixtureRoot, `atom.io.tgz`)
	pnpm(packageRoot, `pack`, `--out`, tarball, `--reporter=silent`)
	await writeJson(join(fixtureRoot, `package.json`), {
		private: true,
		packageManager: workspaceManifest.packageManager,
	})
	await writeFile(
		join(fixtureRoot, `pnpm-workspace.yaml`),
		`packages:\n  - app\nhoist: false\nautoInstallPeers: false\n`,
	)
	const appRoot = join(fixtureRoot, `app`)
	await mkdir(appRoot)
	await writeJson(join(appRoot, `package.json`), {
		name: `atom-react-peer-repro`,
		private: true,
		type: `module`,
		dependencies: {
			"atom.io": `file:${tarball}`,
			react: manifest.devDependencies[`react`],
			"socket.io-client": manifest.devDependencies[`socket.io-client`],
		},
		devDependencies: {
			"@types/react": manifest.devDependencies[`@types/react`],
			typescript: manifest.devDependencies[`typescript`],
		},
	})
	await writeJson(join(appRoot, `tsconfig.json`), {
		compilerOptions: {
			module: `Preserve`,
			moduleResolution: `Bundler`,
			target: `ES2024`,
			strict: true,
			skipLibCheck: true,
			noEmit: true,
			types: [],
		},
		include: [`index.ts`],
	})
	await writeFile(
		join(appRoot, `index.ts`),
		`import { RealtimeContext, type RealtimeReactStore } from "atom.io/realtime-react";
import { useContext } from "react";

export function useRealtimeSocket() {
  const context = useContext(RealtimeContext);
  const { socket } = context;
  // Also reject a context that silently degrades to any.
  // @ts-expect-error The published context has no such property.
  context.nonexistent;
  return socket;
}

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
type SocketType = Expect<Equal<ReturnType<typeof useRealtimeSocket>, RealtimeReactStore["socket"]>>;
`,
	)
	pnpm(fixtureRoot, `install`, `--ignore-scripts`, `--no-frozen-lockfile`)
	pnpm(appRoot, `exec`, `tsc`)
	const installedManifest = JSON.parse(
		await readFile(join(appRoot, `node_modules/atom.io/package.json`), `utf8`),
	) as typeof manifest
	assert.equal(
		installedManifest.peerDependencies[`@types/react`],
		installedManifest.peerDependencies[`react`],
	)
	assert.equal(
		installedManifest.peerDependenciesMeta[`@types/react`].optional,
		true,
	)
	console.log(
		`Packed React declarations retain context and socket types without hoisting.`,
	)
} finally {
	await rm(fixtureRoot, { recursive: true, force: true })
}
