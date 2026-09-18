# @korneevecin/vue3-dialogs-lib

[![npm](https://img.shields.io/npm/v/%40korneevecin%2Fvue3-dialogs-lib)](https://www.npmjs.com/package/@korneevecin/vue3-dialogs-lib)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/RussianScumer/vue3-dialogs-lib/blob/master/LICENSE)

[English](https://github.com/RussianScumer/vue3-dialogs-lib/blob/master/README.md) · **Русский**

Оконный менеджер для Vue 3 на нативном элементе `<dialog>`, без единой runtime-зависимости, кроме
самого Vue.

Окно здесь — **сериализуемый дескриптор в сторе**, а не булево поле компонента, который его открыл.
Поэтому окно переживает своего создателя: его можно свернуть и поднять из любого места приложения,
оно помнит, где стояло на экране, ничего не стоит в свёрнутом виде (контент размонтирован, а не
спрятан), а с включённой персистентностью переживает перезагрузку страницы.

## Возможности

- **Нативный `<dialog>`, немодальный по умолчанию** — несколько окон одновременно, страница под
  ними остаётся рабочей, телепортированные попперы ваших компонентов продолжают работать.
- **Свернуть = размонтировать.** У свёрнутого окна остаются дескриптор и черновик, и больше ничего.
- **Перетаскивание, ресайз за восемь ручек, сдвиг с клавиатуры**, пределы min/max, прижатие к
  вьюпорту, полноэкранный режим ниже мобильного брейкпоинта.
- **Примагничивание к краям** как на десктопе: половины, четверти, максимизация, призрак-превью и
  переназначаемая раскладка клавиш для примагничивания и переключения окон.
- **Персистентность** в любое хранилище `{ getItem, setItem, removeItem }`, с проверкой схемы,
  починкой неполных дескрипторов и защитой от двух вкладок, пишущих в один ключ.
- **Guard закрытия** — общий на приложение и на окно, синхронный или асинхронный — через
  `requestClose()`.
- **Результат окна**: `open()` возвращает промис того, чем окно завершилось, и он никогда не
  зависает.
- **Дочерние окна с владельцем**, **модальные окна** со скримом и `inert`-обходом, **закреплённые**
  (поверх всех) окна и именованные **пресеты**.
- **Типизированный `open()`** — имена окон и их props проверяются по вашей карте компонентов.
- **Состояния загрузки и ошибки** для каждого типа окна, сбой изолирован в одном окне.
- **Работает без стилей.** Раскладка inline; `style.css` — только косметика, настраивается через
  токены `--vtd-*`, плюс 22 готовые цветовые темы.
- **SSR-safe**, ноль runtime-зависимостей, ни одной зашитой пользовательской строки.

## Установка

```sh
pnpm add @korneevecin/vue3-dialogs-lib
# или: npm install @korneevecin/vue3-dialogs-lib
```

Единственное требование — Vue 3.5 или новее (peer-зависимость). Стили опциональны: без них окна
не оформлены, но полностью работоспособны.

## Быстрый старт

Зарегистрируйте компоненты окон один раз и смонтируйте хост над `<router-view>`:

```js
// main.js
import { createWindows } from '@korneevecin/vue3-dialogs-lib'
import '@korneevecin/vue3-dialogs-lib/style.css' // опционально

app.use(createWindows({
  components: {
    itemEditor: () => import('./windows/ItemEditor.vue'),
    logViewer: () => import('./windows/LogViewer.vue'),
  },
  persist: { key: 'app:windows', storage: localStorage }, // уберите, чтобы отключить
  labels: { minimize: 'Свернуть', close: 'Закрыть', pin: 'Поверх всех' },
}))
```

```vue
<!-- App.vue -->
<router-view />
<WindowHost />
<WindowTaskbar v-slot="{ all, active, restore, focus, close }">
  <button
    v-for="w in all"
    :key="w.id"
    :class="{ active: w.id === active }"
    @click="w.minimized ? restore(w.id) : focus(w.id)"
  >
    {{ w.title }}
    <span @click.stop="close(w.id)">✕</span>
  </button>
</WindowTaskbar>
```

`WindowTaskbar` не рисует собственной разметки — внешний вид целиком ваш.

Открывайте окна откуда угодно, внутри `setup()` и снаружи:

```js
import { useWindows } from '@korneevecin/vue3-dialogs-lib'

const win = useWindows()
const { id, result } = win.open('itemEditor', { id: 42 }, { title: 'Item 42', w: 720, h: 520 })

win.minimize(id)
win.restore(id)
await win.requestClose(id)   // прогоняет guard-ы закрытия; false, если один из них отказал
const saved = await result   // { ok: true, data } | { ok: false, reason: 'closed' | 'restored' }
```

Внутри контента окна:

```vue
<script setup>
import { useWindowState, useWindowContext } from '@korneevecin/vue3-dialogs-lib'

const props = defineProps({ id: Number, windowId: String })

// черновик, переживающий сворачивание (размонтирование) и перезагрузку страницы
const form = useWindowState(props.windowId, () => ({ name: '', note: '' }))

const { setTitle, onBeforeClose, resolve, dismiss } = useWindowContext()
setTitle(`Item ${props.id}`)
onBeforeClose(() => !form.name || confirm('Отбросить черновик?'))
</script>
```

Модальный вопрос, ответ — через результат:

```js
const answer = await win.open('confirm', { message }, { modal: true, placement: 'center' }).result
if (answer.ok) proceed()
```

## Документация

| Русский | English | |
| --- | --- | --- |
| [Справочник API](https://github.com/RussianScumer/vue3-dialogs-lib/blob/master/docs/api_ru.md) | [API reference](https://github.com/RussianScumer/vue3-dialogs-lib/blob/master/docs/api.md) | каждая опция, метод и поведение |
| [Режимы окон](https://github.com/RussianScumer/vue3-dialogs-lib/blob/master/docs/window-modes_ru.md) | [Window modes](https://github.com/RussianScumer/vue3-dialogs-lib/blob/master/docs/window-modes.md) | обычное, ограниченное, закреплённое, дочернее, модальное — и что переживает перезагрузку |
| [Как это работает](https://github.com/RussianScumer/vue3-dialogs-lib/blob/master/docs/how-it-works_ru.md) | [How it works](https://github.com/RussianScumer/vue3-dialogs-lib/blob/master/docs/how-it-works.md) | модель дескриптора, путь рендера, геометрия, персистентность |
| [Рецепты](https://github.com/RussianScumer/vue3-dialogs-lib/blob/master/docs/recipes_ru.md) | [Recipes](https://github.com/RussianScumer/vue3-dialogs-lib/blob/master/docs/recipes.md) | законченные сценарии с кодом |
| [Анимация](https://github.com/RussianScumer/vue3-dialogs-lib/blob/master/docs/motion_ru.md) | [Motion](https://github.com/RussianScumer/vue3-dialogs-lib/blob/master/docs/motion.md) | жизненный цикл фрейма, замена анимации, полёт в таскбар |
| [Производительность](https://github.com/RussianScumer/vue3-dialogs-lib/blob/master/docs/performance_ru.md) | [Performance](https://github.com/RussianScumer/vue3-dialogs-lib/blob/master/docs/performance.md) | бенчмарки и что из них следует |
| [Сборка и упаковка](https://github.com/RussianScumer/vue3-dialogs-lib/blob/master/docs/build_ru.md) | [Build and pack](https://github.com/RussianScumer/vue3-dialogs-lib/blob/master/docs/build.md) | настройка pnpm, `dist/`, публикация |

## Чего библиотека не делает

`showModal()` и браузерный top layer, focus-trap, хелперы confirm/alert, загрузку данных и
разрешение устаревших черновиков, синхронизацию раскладки между устройствами, тайловый оконный
менеджер и встроенную дизайн-систему. Модальные окна — узкое прочтение первых двух пунктов:
опциональный скрим и `inert`-обход, по одному окну.

## Разработка

```sh
pnpm install
pnpm dev              # playground в playground/
pnpm exec vitest run  # проекты unit (jsdom) и browser (Playwright Chromium)
pnpm bench            # бенчмарки
pnpm lint && pnpm type-check
pnpm build            # dist/
pnpm pack             # локальный tarball; prepack сначала пересобирает dist/
```

Браузерному проекту тестов один раз нужен Chromium: `pnpm exec playwright install chromium`.

## Лицензия

[MIT](./LICENSE)
