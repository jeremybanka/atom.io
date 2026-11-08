import { resumableRenderer } from "resumability/astro-server"

import { createRenderer } from "./astro-server.ts"

export default resumableRenderer(createRenderer(true), {
	isolate: (component) => Boolean(component.createStore ?? component.isolate),
})
