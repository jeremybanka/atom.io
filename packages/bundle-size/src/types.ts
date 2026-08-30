export type BundlePlatform = `browser` | `neutral` | `node`

export type BundleSizeExports = {
	exclude?: readonly string[]
	include?: readonly string[]
}

export type BundleSizeRecipe = {
	entry: string
	external?: readonly string[]
	name: string
	platform?: BundlePlatform
}

export type BundleSizeConfig = {
	exports?: boolean | BundleSizeExports
	external?: readonly string[]
	heading?: string
	marker?: string
	packageJson?: string
	platform?: BundlePlatform
	readme?: string
	recipes?: readonly BundleSizeRecipe[]
	target?: string
}

export type BundleMeasurement = {
	gzipBytes: number
	rawBytes: number
}

export type BundleSizeRow = BundleMeasurement & {
	imports: readonly string[]
	name: string
}

export type BundleSizeRecipeRow = BundleMeasurement & {
	entry: string
	name: string
}

export type BundleSizeReport = {
	exports: readonly BundleSizeRow[]
	packageName: string
	recipes: readonly BundleSizeRecipeRow[]
}

export type BundleSizeMode = `check` | `write`

export type BundleSizeRunResult = {
	changed: boolean
	readmePath: string
	report: BundleSizeReport
}
