import { mountDashboard } from "./dashboard.ts"
import "./style.css"

const root = document.querySelector<HTMLElement>(`#app`)
if (!root) throw new Error(`Missing dashboard root`)
const unmount = mountDashboard(root)

if (import.meta.hot) import.meta.hot.dispose(unmount)
