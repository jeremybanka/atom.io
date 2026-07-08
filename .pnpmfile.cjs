const TYPESCRIPT_FOR_TYPESCRIPT_ESLINT = "6.0.3"

const usesTypeScriptEslint = (name) =>
	typeof name === "string" &&
	(name === "typescript-eslint" || name.startsWith("@typescript-eslint/"))

module.exports = {
	hooks: {
		readPackage(packageJson) {
			if (
				usesTypeScriptEslint(packageJson.name) &&
				packageJson.peerDependencies?.typescript
			) {
				delete packageJson.peerDependencies.typescript
				delete packageJson.peerDependenciesMeta?.typescript
				packageJson.dependencies = {
					...packageJson.dependencies,
					typescript: TYPESCRIPT_FOR_TYPESCRIPT_ESLINT,
				}
			}

			return packageJson
		},
	},
}
