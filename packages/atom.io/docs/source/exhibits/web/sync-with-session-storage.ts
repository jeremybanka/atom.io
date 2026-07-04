import { atom } from "atom.io"
import { storageSync } from "atom.io/web"

export const sidebarOpenForSessionAtom = atom<boolean | null>({
	key: `sidebarOpenForSession`,
	default: true,
	effects: [storageSync(sessionStorage, JSON, `sidebarOpen`)],
})
