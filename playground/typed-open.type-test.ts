// Type-level regression guard for the typed open(). Never imported at runtime; it exists so
// `npm run type-check` fails if prop inference through an async loader, or result inference through
// a spec's `result` marker, breaks.
import { useWindows } from '../src'
import { components } from './components'
import type { SavedItem } from './types'

const win = useWindows<typeof components>()

// @ts-expect-error unknown window name
win.open('nope', {})
// @ts-expect-error id must be a number
win.open('itemEditor', { id: 'x' })
// @ts-expect-error id is required
win.open('itemEditor', {})
win.open('itemEditor', { id: 42 })
win.open('itemEditor', { id: 42 }, { title: 'Item 42', minW: 300, closable: false })

// The handle is `{ id, result }` — an id where a string is wanted, never the handle itself.
const handle = win.open('itemEditor', { id: 42 })
const id: string = handle.id
win.close(id)
// @ts-expect-error the handle is not the id
win.close(handle)

async function results() {
  // Inferred: `itemEditor` declares `result: SavedItem`, so `data` is one.
  const saved = await win.open('itemEditor', { id: 42 }).result
  if (saved.ok) {
    const item: SavedItem = saved.data
    void item
    // @ts-expect-error the result is a SavedItem, not a string
    const wrong: string = saved.data
    void wrong
  } else {
    const reason: 'closed' | 'restored' = saved.reason
    void reason
  }

  // Un-inferable: a bare loader carries no marker, so `data` degrades to `unknown` rather than
  // making the call an error.
  const popper = await win.open('popperDemo', {}).result
  // @ts-expect-error unknown is not assignable to a string
  const noType: string = popper.ok && popper.data
  void noType

  // A spec with defaults but no `result` marker: `unknown` again, not `never`.
  const viewer = await win.open('logViewer', { source: 'app' }).result
  if (viewer.ok) {
    const anything: unknown = viewer.data
    void anything
  }

  // The untyped store still opens windows; it just cannot say what they settle with.
  const bare = await useWindows().open('anything').result
  // @ts-expect-error unknown is not assignable to a number
  const alsoUnknown: number = bare.ok && bare.data
  void alsoUnknown
}

void results
