// Guarded so the SSR spec, which runs in the node environment, can load this file too.
if (typeof HTMLDialogElement !== 'undefined') {
  // jsdom ships HTMLDialogElement without show()/close(); the real behavior is covered
  // by the browser, this shim only keeps the component suite runnable here.
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & {
    show?: () => void
    close?: () => void
  }

  if (typeof proto.show !== 'function') {
    proto.show = function show(this: HTMLDialogElement) {
      this.setAttribute('open', '')
    }
    proto.close = function close(this: HTMLDialogElement) {
      this.removeAttribute('open')
      this.dispatchEvent(new Event('close'))
    }
  }

  // jsdom has no pointer capture; the drag path is real code and worth covering here.
  const el = HTMLElement.prototype as HTMLElement & { setPointerCapture?: (id: number) => void }
  if (typeof el.setPointerCapture !== 'function') {
    const captured = new WeakMap<HTMLElement, Set<number>>()
    const ids = (node: HTMLElement) => captured.get(node) ?? captured.set(node, new Set()).get(node)!
    el.setPointerCapture = function (this: HTMLElement, id: number) {
      ids(this).add(id)
    }
    el.releasePointerCapture = function (this: HTMLElement, id: number) {
      ids(this).delete(id)
    }
    el.hasPointerCapture = function (this: HTMLElement, id: number) {
      return ids(this).has(id)
    }
  }
}
