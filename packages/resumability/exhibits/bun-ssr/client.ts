import { createResumption } from "resumability/client"

import { readCount } from "./count.ts"

const app = document.getElementById(`app`)!
const scope = createResumption(app)
const output = app.querySelector<HTMLOutputElement>(`#browser-count`)!

async function showCount() {
	output.value = String(await scope.run(readCount))
}

await showCount()
app.querySelector(`button`)!.addEventListener(`click`, () => void showCount())
