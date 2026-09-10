# Motion

The library ships a state machine, not an animation. `WindowHost` marks every frame `entering`,
`open` or `leaving` and keeps a leaving frame mounted for as long as the stylesheet says; the
stylesheet decides what those three states look like. There is no `<Transition>` wrapper anywhere,
and no keyframes for the window itself.

That split is what makes the motion replaceable: change the CSS and the machine does not care, as
long as it can still read one number back off the element.

## The one property

```css
:root {
  --vtd-motion-duration: 240ms; /* baseline is 180ms */
}
```

`--vtd-motion-duration` is the only custom property `style.css` *declares* rather than only reads,
because `WindowHost` has to read a value back. It does two jobs at once:

- the CSS transitions on `.vw` use it as their duration;
- `durationOf()` reads it off the window element with `getComputedStyle` to decide how long to keep
  a leaving frame in the render tree.

Set it to `0ms` and windows appear and vanish in one frame, exactly as they do with no stylesheet
imported at all. `prefers-reduced-motion: reduce` already does that for you.

The declaration is wrapped in `:where(:root)` so it carries zero specificity: your own `:root`, a
theme class or an inline style on `<html>` all win without having to out-specify anything.

Two limits worth knowing:

- **The cap is 1000ms** (`MAX_LEAVING_MS` in `WindowHost.vue`). Ask for 1500ms and the frame is
  still retired at 1000ms, cutting the animation off.
- **A bare number counts as milliseconds.** `300` is not a valid CSS `<time>`, but the parser
  treats it as `300ms` rather than retaining the frame for 300 seconds. `0.4s` is read as 400ms.

## The lifecycle

| State | Set when | Ends when |
|---|---|---|
| `entering` | the frame is created, *before* its first render | the next animation frame |
| `open` | steady state | the window leaves the store |
| `leaving` | the window closed or minimized | `--vtd-motion-duration` later |

It reaches the DOM as `data-vw-state` on the window's `<dialog class="vw">`, and as a `state` prop
on `BaseWindow` (`WindowVisualState`, exported).

Three details follow from how the states are produced, and they are the reason the stylesheet uses
transitions instead of keyframes:

- **The enter is the *removal* of `entering`, on the next `requestAnimationFrame`.** The frame is
  marked before it is first painted, so there is a real painted state to transition out of.
- **A hidden tab is released immediately instead.** A background tab paints nothing and delivers no
  animation frame at all, so waiting for one would leave the window sitting at whatever `entering`
  looks like — invisible, in the baseline sheet — until the tab is looked at again.
- **An interrupted leave animates back.** Restore a window mid-flight and the same frame is adopted
  back with `state = 'open'`; the running transition simply reverses. A separate keyframe animation
  would have had to be cancelled.

A leaving frame keeps its content when it is *closing*, and loses it when it is *minimizing* — a
window that fades out empty reads as a bug, but a minimized window's content is unmounted the moment
it is minimized, which is the whole "minimized costs nothing" claim.

## What the baseline sheet does

```css
.vw {
  transition:
    opacity var(--vtd-motion-duration, 0ms) ease,
    scale var(--vtd-motion-duration, 0ms) ease,
    translate var(--vtd-motion-duration, 0ms) ease;
}

.vw[data-vw-state='entering'] {
  opacity: 0;
  scale: 0.96;
}

.vw[data-vw-state='leaving'] {
  opacity: 0;
  translate: var(--vtd-min-x, 0) var(--vtd-min-y, 0);
  scale: var(--vtd-min-scale, 0.96);
}
```

**`scale` and `translate` are the separate CSS properties, never `transform`.** The frame's own
`transform` is its position on the desktop, written inline by the store; animating `transform` here
would overwrite it and the window would jump to the top-left corner. The separate properties
compose with it instead.

For the same reason, never put `transform` into a `transition` on `.vw`: a drag writes `transform`
every frame, and a transition makes the window lag a frame behind the pointer.

## Replacing the animation

Override the three rules. Anything animatable works, as long as it stays off `transform`:

```css
:root { --vtd-motion-duration: 260ms; }

.vw[data-vw-state='entering'] {
  opacity: 0;
  scale: 1;
  translate: 0 16px;
  filter: blur(2px);
}

.vw[data-vw-state='leaving'] {
  opacity: 0;
  scale: 0.94;
  translate: 0 8px;
}
```

If you add a property that is not in the baseline `transition` list — `filter` above — add it to
the list as well, or it will snap instead of animate:

```css
.vw {
  transition:
    opacity var(--vtd-motion-duration) ease,
    scale var(--vtd-motion-duration) ease,
    translate var(--vtd-motion-duration) ease,
    filter var(--vtd-motion-duration) ease;
}
```

Different easing or duration per direction is a plain CSS matter — the host only ever reads the
single number, so keep the *longest* of them in `--vtd-motion-duration` or the frame will be retired
mid-animation:

```css
.vw[data-vw-state='leaving'] {
  transition-timing-function: cubic-bezier(0.4, 0, 1, 1);
}
```

## The fly-to-taskbar minimize

A minimizing window can shrink towards its taskbar button instead of fading in place. Three custom
properties are set inline on the leaving frame:

| Property | Value |
|---|---|
| `--vtd-min-x`, `--vtd-min-y` | offset from the window's own centre to the centre of its taskbar button |
| `--vtd-min-scale` | the scale that would fit the window into that button |

They appear **only** when the window is minimizing *and* the consumer registered a rect for it:

```vue
<WindowTaskbar v-slot="{ all, restore, setTaskbarRect }">
  <button
    v-for="w in all"
    :key="w.id"
    :ref="(el) => setTaskbarRect(w.id, el)"
    @click="restore(w.id)"
  >
    {{ w.title }}
  </button>
</WindowTaskbar>
```

Measure from a ref callback like this rather than once on mount, so the rect is re-taken whenever
the button moves. Without a registered rect — and always for a *closing* window, which has no button
to fly to — the properties are absent and the `var()` fallbacks turn the rule back into a plain fade.

To keep the flight but change nothing else, override just the scale:

```css
.vw[data-vw-state='leaving'] { scale: var(--vtd-min-scale, 0.8); }
```

## The modal scrim

The scrim behind a modal window fades with a keyframe animation, on the same property:

```css
.vw-scrim {
  background: var(--vtd-scrim-bg, rgba(0, 0, 0, 0.4));
  animation: vw-scrim-in var(--vtd-motion-duration, 0ms) ease;
}
```

There is one scrim, under the topmost modal only, and it is unmounted with that window's frame — so
the scrim and the window it belongs to always leave together. `--vtd-scrim-bg` changes the tint
without touching the fade.

## A different animation for one window

The window's root element carries `data-vw-state`, `data-vw-active`, `data-vw-error` and
`aria-label` (the window title). There is no consumer-supplied class on it, so a single window is
addressed **by its title**:

```css
.vw[aria-label='Activity log'] {
  --vtd-motion-duration: 450ms;
}

.vw[aria-label='Activity log'][data-vw-state='entering'] {
  opacity: 0;
  scale: 1;
  translate: 0 24px;
}

.vw[aria-label='Activity log'][data-vw-state='leaving'] {
  opacity: 0;
  scale: 0.9;
  translate: 0 24px;
}
```

Four things make or break this:

1. **Pair the attributes.** `.vw[data-vw-state='leaving']` in `style.css` has specificity `(0,2,0)`,
   and so does `.vw[aria-label='…']` on its own — a tie, decided by stylesheet order. Combining both
   attributes gives `(0,3,0)` and wins regardless of load order.
2. **The duration really is per-window.** `durationOf()` calls `getComputedStyle` on that particular
   window element, so this frame is retained for 450ms while every other one is retained for the
   global value.
3. **Stay under the 1000ms cap.**
4. **The title must be stable.** `setTitle()` rewrites `aria-label`, and the selector stops matching.

If the title is dynamic, mark your content component's root element and select the frame with
`:has()`:

```css
.vw:has([data-kind='log']) { --vtd-motion-duration: 450ms; }
```

This is correct for opening and closing, and **wrong for minimize**: the content is unmounted in the
same DOM patch that sets `data-vw-state='leaving'`, so `:has()` stops matching exactly when the
transition starts, the duration falls back to the global value, and the frame is then held longer
than the animation runs. Use the title selector for anything that has to survive a minimize.

## Checklist for a custom motion

- Longest duration of any property is in `--vtd-motion-duration`, and it is ≤ 1000ms.
- Nothing animates `transform`, and `transform` is not in any `transition` on `.vw`.
- Every property you set in `entering`/`leaving` is listed in the `transition` on `.vw`.
- `prefers-reduced-motion: reduce` still resolves to `0ms` — if you redeclare the property, keep the
  media query.
- The library still works with the stylesheet removed entirely: no motion, no retained frames, and
  windows that appear and vanish in one frame.

## Where the code is

| Concern | File |
|---|---|
| Frame lifecycle, `entering`/`leaving`, retention timers, `durationOf()` | `src/WindowHost.vue` |
| `data-vw-state` on the element, `--vtd-min-*` computation | `src/BaseWindow.vue` |
| Transitions, states, scrim fade, reduced-motion, the duration declaration | `src/style.css` |
| `setTaskbarRect` | `src/WindowTaskbar.vue` |
