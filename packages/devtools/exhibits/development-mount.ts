import type {
	AtomIODevtoolsHandle,
	AtomIODevtoolsProps,
} from "@atom.io/devtools"

export async function mountDevelopmentDevtools(
	host: Element,
	options?: AtomIODevtoolsProps,
): Promise<AtomIODevtoolsHandle | undefined> {
	if (import.meta.env.DEV) {
		const [{ mountAtomIODevtools }] = await Promise.all([
			import(`@atom.io/devtools`),
			import(`@atom.io/devtools/css`),
		])
		return mountAtomIODevtools(host, options)
	}
}
