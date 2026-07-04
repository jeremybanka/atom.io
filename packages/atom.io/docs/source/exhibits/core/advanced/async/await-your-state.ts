import http from "node:http"

import type { Loadable } from "atom.io"
import { atom, getState, resetState } from "atom.io"

const server = http.createServer((req, res) => {
	let data: Uint8Array[] = []
	req
		.on(`data`, (chunk) => data.push(chunk))
		.on(`end`, () => {
			res.writeHead(200, { "Content-Type": `text/plain` })
			res.end(`The best way to predict the future is to invent it.`)
			data = []
		})
})
server.listen(3000)

export const quoteAtom = atom<Loadable<string>, Error>({
	key: `quote`,
	default: async () => {
		const response = await fetch(`http://localhost:3000`)
		return response.text()
	},
	catch: [Error],
})

void getState(quoteAtom) // Promise { <pending> }
await getState(quoteAtom) // "The best way to predict the future is to invent it."
void getState(quoteAtom) // "The best way to predict the future is to invent it."
resetState(quoteAtom)
void getState(quoteAtom) // Promise { <pending> }
