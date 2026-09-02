// Type-level regression guard for the typed open(). Never imported at runtime; it exists so
// `npm run type-check` fails if prop inference through an async loader breaks.
import { useWindows } from '../src'

export const components = {
  itemEditor: () => import('./windows/ItemEditor.vue'),
  logViewer: () => import('./windows/LogViewer.vue'),
}

const win = useWindows<typeof components>()

// @ts-expect-error unknown window name
win.open('nope', {})
// @ts-expect-error id must be a number
win.open('itemEditor', { id: 'x' })
// @ts-expect-error id is required
win.open('itemEditor', {})
win.open('itemEditor', { id: 42 })
win.open('itemEditor', { id: 42 }, { title: 'Item 42', minW: 300, closable: false })
