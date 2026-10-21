import { execFileSync } from "node:child_process"
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dirname, `..`)
const staging = await mkdtemp(join(tmpdir(), `atom-io-realtime-consumers-`))
function pnpm(cwd: string, ...args: string[]): void {
	execFileSync(`pnpm`, [`--reporter=silent`, ...args], {
		cwd,
		stdio: `inherit`,
		timeout: 180_000,
	})
}
try {
	for (const [name, directory] of [
		[`core`, `atom.io`],
		[`react`, `react`],
		[`realtime`, `realtime`],
	]) {
		pnpm(
			resolve(root, `..`, directory),
			`pack`,
			`--out`,
			join(staging, `${name}.tgz`),
		)
	}
	for (const mode of [`minimal`, `server`, `react18`, `react19`, `lexical`]) {
		const app = join(staging, mode)
		await mkdir(app)
		const deps: Record<string, string> = {
			"atom.io": `file:../core.tgz`,
			"@atom.io/realtime": `file:../realtime.tgz`,
			typescript: `7.0.2`,
			"@types/node": `26.6.5`,
		}
		if (mode.startsWith(`react`) || mode === `lexical`) {
			const react18 = mode === `react18`
			Object.assign(deps, {
				"@atom.io/react": `file:../react.tgz`,
				react: react18 ? `18.3.1` : `19.3.1`,
				"react-dom": react18 ? `18.3.1` : `19.3.1`,
				"@types/react": react18 ? `18.3.31` : `19.3.0`,
				"@types/react-dom": react18 ? `18.3.7` : `19.3.0`,
			})
		}
		if (mode === `server` || mode === `lexical`)
			Object.assign(deps, { "socket.io": `4.8.4`, "socket.io-client": `4.8.4` })
		if (mode === `lexical`)
			Object.assign(deps, {
				lexical: `0.49.0`,
				"@lexical/react": `0.49.0`,
				"@lexical/selection": `0.49.0`,
				"@testing-library/react": `16.3.3`,
				"@testing-library/dom": `10.4.2`,
				"happy-dom": `21.0.3`,
			})
		await writeFile(
			join(app, `package.json`),
			JSON.stringify({ private: true, type: `module`, dependencies: deps }),
		)
		await writeFile(
			join(app, `pnpm-workspace.yaml`),
			`autoInstallPeers: false\n`,
		)
		const fixture = mode.startsWith(`react`) ? `react` : mode
		await cp(
			join(root, `__tests__/fixtures/consumer/${fixture}.ts`),
			join(app, `consumer.ts`),
		)
		pnpm(app, `install`, `--ignore-scripts`, `--no-frozen-lockfile`)
		execFileSync(process.execPath, [join(app, `consumer.ts`)], {
			cwd: app,
			stdio: `inherit`,
		})
		pnpm(
			app,
			`exec`,
			`tsc`,
			`--ignoreConfig`,
			`--module`,
			`Preserve`,
			`--moduleResolution`,
			`Bundler`,
			`--target`,
			`ES2024`,
			`--lib`,
			`ESNext,DOM`,
			`--strict`,
			`--strictFunctionTypes`,
			`false`,
			`--types`,
			`node`,
			`--noEmit`,
			`consumer.ts`,
		)
		console.log(`Packed consumer passed: ${mode}`)
	}
} finally {
	await rm(staging, { recursive: true, force: true })
}
