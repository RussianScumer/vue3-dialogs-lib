/**
 * Dev-only, and the one way the library talks to a developer: it ships no user-facing strings, and
 * a misconfiguration or a bug in a guard is for whoever is building the app, not for its users. A
 * production build drops the branch along with every message passed to it.
 */
export function warn(message: string, ...details: unknown[]): void {
  if (import.meta.env?.DEV) console.warn(`[vue3-dialogs-lib] ${message}`, ...details)
}
