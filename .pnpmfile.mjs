const TYPESCRIPT_FOR_TYPESCRIPT_ESLINT_8 = "6.0.3"

// TypeScript ESLint v8 reads compiler internals that changed in TypeScript 7.
// Remove this once the TypeScript ESLint stack supports TypeScript 7.
const TYPESCRIPT_ESLINT_PACKAGES = new Set([
	"typescript-eslint",
	"@typescript-eslint/eslint-plugin",
	"@typescript-eslint/parser",
	"@typescript-eslint/project-service",
	"@typescript-eslint/rule-tester",
	"@typescript-eslint/tsconfig-utils",
	"@typescript-eslint/type-utils",
	"@typescript-eslint/typescript-estree",
	"@typescript-eslint/utils",
])

const needsTypescript6 = (packageJson) =>
	TYPESCRIPT_ESLINT_PACKAGES.has(packageJson.name) &&
	packageJson.version?.startsWith("8.") === true &&
	packageJson.peerDependencies?.typescript !== undefined

export const hooks = {
	readPackage(packageJson) {
		if (needsTypescript6(packageJson)) {
			delete packageJson.peerDependencies.typescript
			delete packageJson.peerDependenciesMeta?.typescript
			packageJson.dependencies = {
				...packageJson.dependencies,
				typescript: TYPESCRIPT_FOR_TYPESCRIPT_ESLINT_8,
			}
		}

		return packageJson
	},
}
