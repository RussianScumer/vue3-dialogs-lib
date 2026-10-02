// Type-level regression guard for the event payloads. Never imported at runtime; it exists so
// `pnpm type-check` fails if `WindowEvent` stops being a union a listener can narrow on `type`.
// The specs are not type-checked, so the same assertion in `events.spec.ts` alone proves nothing.
import { useWindows, type WindowEvent } from '../src'

const win = useWindows()

// @ts-expect-error `rect` exists on `geometry` only, so the bare union does not have it
export const bare = (e: WindowEvent) => e.rect

win.on('*', (e) => {
  if (e.type === 'geometry') void e.rect.w
  if (e.type === 'close') void [e.reason, e.result.ok, e.descriptor.title]
  // The base shape every listener before the payloads was written against.
  void [e.type, e.id]
})

// A named type hands the listener that type's payload directly.
win.on('snap', (e) => void e.zone)
win.on('active', (e) => void e.previous)
// @ts-expect-error `pinned` belongs to `pin`, not `focus`
win.on('focus', (e) => void e.pinned)
// A listener written against the whole union still fits any one type.
win.on('close', (e: WindowEvent) => void e.id)
