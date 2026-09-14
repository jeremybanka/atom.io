import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import * as prompts from "@clack/prompts"
import { x } from "tinyexec"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { TemplateName } from "../src/create-atom.ts"
import { createAtom } from "../src/create-atom.ts"

const getPackageInfoMock = vi.hoisted(() =>
	vi.fn<(name: string) => { rootPath: string }>(),
)

vi.mock(`@clack/prompts`, async (importOriginal) => ({
	...(await importOriginal<typeof prompts>()),
	intro: vi.fn(),
	outro: vi.fn(),
	select: vi.fn(),
	spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
	text: vi.fn(),
}))

vi.mock(`local-pkg`, () => ({ getPackageInfo: getPackageInfoMock }))
vi.mock(`tinyexec`, () => ({ x: vi.fn() }))

const templates: TemplateName[] = [
	`preact-svg-editor`,
	`react-node-backend`,
	`react-realtime-text-editor`,
	`solid-lossless-numbers`,
]

describe(`createAtom preloaded options`, () => {
	let testDir: string
	let targetDir: string

	beforeEach(async () => {
		vi.clearAllMocks()
		testDir = await mkdtemp(join(tmpdir(), `create-atom-test-`))
		targetDir = join(testDir, `project`)
		for (const templateName of templates) {
			const rootPath = join(testDir, `@atom.io`, `template-${templateName}`)
			await mkdir(rootPath, { recursive: true })
			await writeFile(join(rootPath, `template.txt`), templateName)
		}
		getPackageInfoMock.mockImplementation((name) => ({
			rootPath: join(testDir, name),
		}))
		vi.mocked(prompts.select).mockResolvedValue(`solid-lossless-numbers`)
		vi.mocked(prompts.text).mockResolvedValue(targetDir)
	})

	afterEach(async () => {
		vi.restoreAllMocks()
		await rm(testDir, { recursive: true, force: true })
	})

	it.each(templates)(
		`scaffolds the preselected %s template without prompting`,
		async (templateName) => {
			await createAtom(targetDir, {
				packageManager: `npm`,
				skipHints: true,
				templateName,
				useMise: false,
			})

			expect(prompts.select).not.toHaveBeenCalled()
			expect(prompts.text).not.toHaveBeenCalled()
			expect(await readFile(join(targetDir, `template.txt`), `utf-8`)).toBe(
				templateName,
			)
			expect(x).toHaveBeenCalledWith(`npm`, [`install`], {
				nodeOptions: { stdio: `ignore`, cwd: targetDir },
			})
		},
	)

	it(`prompts for a template when none is preselected`, async () => {
		await createAtom(targetDir, {
			packageManager: `npm`,
			skipHints: true,
			useMise: false,
		})

		expect(prompts.select).toHaveBeenCalledOnce()
		expect(await readFile(join(targetDir, `template.txt`), `utf-8`)).toBe(
			`solid-lossless-numbers`,
		)
	})

	it(`prompts for a project directory when it is undefined`, async () => {
		await createAtom(undefined, {
			packageManager: `npm`,
			skipHints: true,
			templateName: `react-node-backend`,
			useMise: false,
		})

		expect(prompts.text).toHaveBeenCalledOnce()
		expect(await readFile(join(targetDir, `template.txt`), `utf-8`)).toBe(
			`react-node-backend`,
		)
	})

	it(`uses the current directory when the supplied directory is empty`, async () => {
		vi.spyOn(process, `cwd`).mockReturnValue(targetDir)

		await createAtom(``, {
			packageManager: `npm`,
			skipHints: true,
			templateName: `react-node-backend`,
			useMise: false,
		})

		expect(prompts.text).not.toHaveBeenCalled()
		expect(await readFile(join(targetDir, `template.txt`), `utf-8`)).toBe(
			`react-node-backend`,
		)
	})
})
