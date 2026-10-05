import { describe, expect, expectTypeOf, it } from 'vitest'
import type {
  AsyncWindowOptions,
  BeforeCloseGuard,
  Bounds,
  CloseGuard,
  ComponentsMap,
  ExternalChangeInfo,
  KeyChord,
  KeymapAction,
  KeymapOptions,
  ModalOptions,
  OpenOptions,
  PersistOptions,
  Rect,
  ResizeDir,
  ResolvedKeymap,
  ResolvedModal,
  ResolvedOptions,
  ResolvedSnap,
  SizeLimits,
  SnapInsets,
  SnapOptions,
  SnapZone,
  StorageLike,
  TypedWindowsApi,
  Viewport,
  WindowComponent,
  WindowContext,
  WindowDefaults,
  WindowDescriptor,
  WindowEntry,
  WindowEvent,
  WindowEventType,
  WindowHandle,
  WindowPlacement,
  WindowProps,
  WindowResult,
  WindowResultOf,
  WindowSpec,
  WindowsApi,
  WindowsOptions,
  WindowVisualState,
} from '../index'

/**
 * The public surface, by name. A rename or a dropped export is a breaking change for every
 * consumer, so it has to fail here rather than surface as an import error in someone else's app.
 */
describe('public exports', () => {
  it('ships exactly these runtime exports', async () => {
    const lib = await import('../index')
    expect(Object.keys(lib).sort()).toEqual([
      'BaseWindow',
      'RESIZE_DIRS',
      'WindowHost',
      'WindowTaskbar',
      'createWindows',
      'provideWindowContext',
      'useWindowContext',
      'useWindowDrag',
      'useWindowOptions',
      'useWindowResize',
      'useWindowState',
      'useWindows',
    ])
  })

  it('ships the type exports', () => {
    // The import above is the assertion: a type that leaves `index.ts` fails `pnpm type-check`.
    // These few pin shapes a consumer is most likely to write against.
    expectTypeOf<ResizeDir>().toEqualTypeOf<'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se'>()
    expectTypeOf<WindowResult<number>>().toEqualTypeOf<
      { ok: true; data: number } | { ok: false; reason: 'closed' | 'restored' }
    >()
    expectTypeOf<WindowContext<string>['resolve']>().parameter(0).toEqualTypeOf<string>()
    expectTypeOf<SizeLimits>().toEqualTypeOf<{
      minW: number
      minH: number
      maxW: number | null
      maxH: number | null
    }>()
    expectTypeOf<WindowsApi>().toHaveProperty('open')
    expectTypeOf<TypedWindowsApi<ComponentsMap>>().toHaveProperty('open')

    // Referenced so the list above stays a list of names the build really exports.
    expectTypeOf<
      [
        AsyncWindowOptions, BeforeCloseGuard, Bounds, CloseGuard, ExternalChangeInfo, KeyChord,
        KeymapAction, KeymapOptions, ModalOptions, OpenOptions, PersistOptions, Rect, ResolvedKeymap,
        ResolvedModal, ResolvedOptions, ResolvedSnap, SnapInsets, SnapOptions, SnapZone, StorageLike,
        Viewport, WindowComponent, WindowDefaults, WindowDescriptor, WindowEntry, WindowEvent,
        WindowEventType, WindowHandle, WindowPlacement, WindowProps<unknown>, WindowResultOf<unknown>,
        WindowSpec, WindowsOptions, WindowVisualState,
      ]
    >().not.toBeNever()
  })
})
