import "@atom.io/spa/brand/css"

import type { SpaElement } from "@atom.io/spa"
import { BrandMark } from "@atom.io/spa/brand"

export function AppBrand(): SpaElement {
	return <BrandMark size={32} />
}
