import { reactive } from 'vue'

export interface LogEntry {
  at: string
  text: string
}

const state = reactive({
  entries: [] as LogEntry[],
  /** Live mount count per window type — the proof that minimized content is unmounted. */
  mounts: {} as Record<string, number>,
})

export function log(text: string): void {
  state.entries.unshift({ at: new Date().toLocaleTimeString(), text })
  if (state.entries.length > 60) state.entries.length = 60
}

export function trackMount(kind: string, delta: number): void {
  state.mounts[kind] = (state.mounts[kind] ?? 0) + delta
  log(`${kind} ${delta > 0 ? 'mounted' : 'unmounted'} (live: ${state.mounts[kind]})`)
}

export function useEventLog() {
  return state
}
