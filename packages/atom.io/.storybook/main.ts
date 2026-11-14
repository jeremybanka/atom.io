import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import type { StorybookConfig } from "@storybook/react-vite"
import type { Plugin } from "vite"
import { mergeConfig } from "vite"

import spa from "../../spa/src/vite.ts"

const STORYBOOK_ROOT = dirname(fileURLToPath(import.meta.url))

/**
 * This function is used to resolve the absolute path of a package.
 * It is needed in projects that use Yarn PnP or are set up within a monorepo.
 */
function getAbsolutePath(value: string): any {
	return dirname(resolve(join(`node_modules`, value, `package.json`)))
}
const config: StorybookConfig = {
	stories: [`../__stories__/**/*.mdx`, `../__stories__/**/*.stories.ts{,x}`],
	addons: [
		getAbsolutePath(`@storybook/addon-docs`),
		getAbsolutePath(`@storybook/addon-onboarding`),
	],
	framework: {
		name: getAbsolutePath(`@storybook/react-vite`),
		options: {},
	},
	viteFinal: async (cfg) => {
		// B-028: react-docgen overflows on the overloaded React binding hooks.
		// Keep documentation extraction for story components, excluding only that package.
		const plugins = await Promise.all(cfg.plugins ?? [])
		for (const plugin of plugins) {
			if (
				!plugin ||
				Array.isArray(plugin) ||
				plugin.name !== `storybook:react-docgen-plugin`
			)
				continue
			const docgen = plugin as Plugin
			if (typeof docgen.transform !== `function`)
				throw new Error(`Unexpected react-docgen transform shape`)
			docgen.transform = {
				filter: { id: { exclude: [/\/packages\/react\/(src|dist)\//] } },
				handler: docgen.transform,
			}
		}
		return mergeConfig(cfg, {
			plugins: [spa({ include: /\/spa-devtools\/.*\.tsx$/ })],
			resolve: {
				alias: [
					{
						find: /^@atom\.io\/spa-devtools\/react$/,
						replacement: resolve(
							STORYBOOK_ROOT,
							`../../spa-devtools/src/react.ts`,
						),
					},
					{
						find: /^@atom\.io\/spa-devtools\/css$/,
						replacement: resolve(
							STORYBOOK_ROOT,
							`../../spa-devtools/src/devtools.css`,
						),
					},
					{
						find: /^@atom\.io\/react-devtools\/css$/,
						replacement: resolve(
							STORYBOOK_ROOT,
							`../../react-devtools/src/devtools.css`,
						),
					},
					{
						find: /^atom\.io$/,
						replacement: resolve(STORYBOOK_ROOT, `../src/main`),
					},
					{
						find: /^atom\.io\/(.*)$/,
						replacement: resolve(STORYBOOK_ROOT, `../src/$1`),
					},
				],
			},
		})
	},
}
export default config
