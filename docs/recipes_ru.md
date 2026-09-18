# Рецепты

Каждый фрагмент ниже — законченный рабочий сценарий. Playground (`pnpm dev`) показывает случаи
1–14 рядом друг с другом.

## 1 · Установка и монтирование

```js
// main.js
import { createApp } from 'vue'
import { createWindows } from '@korneevecin/vue3-dialogs-lib'
import '@korneevecin/vue3-dialogs-lib/style.css' // необязательная базовая таблица стилей
import App from './App.vue'

createApp(App)
  .use(createWindows({
    components: {
      itemEditor: () => import('./windows/ItemEditor.vue'),
      logViewer: () => import('./windows/LogViewer.vue'),
    },
    persist: { key: 'app:windows', storage: localStorage }, // уберите, чтобы отключить
    maxWindows: 8,
    bounds: { minVisible: 80 },
    mobileBreakpoint: 768,
  }))
  .mount('#app')
```

```vue
<!-- App.vue — смонтируйте хост один раз, над выводом роутера -->
<template>
  <router-view />
  <WindowHost />
</template>

<script setup>
import { WindowHost } from '@korneevecin/vue3-dialogs-lib'
</script>
```

## 2 · Открыть окно

```js
import { useWindows } from '@korneevecin/vue3-dialogs-lib'

const win = useWindows()
const { id } = win.open('itemEditor', { id: 42 }, { title: 'Item 42', w: 720, h: 520 })
```

`open(name, props, options)` возвращает `{ id, result }` — идентификатор и промис с тем, чем окно
разрешилось (рецепт 21). `options` принимает `title`, `x`, `y`, `w`, `h` и `meta`; всё пропущенное
выкладывается каскадом или откатывается к 640×480.

Повторный вызов с тем же `name` и поверхностно равными `props` **не** открывает второе окно — он
восстанавливает и поднимает существующее и возвращает handle с тем же id. Именно это делает «одно
окно на сущность» бесплатным:

```js
win.open('itemEditor', { id: 42 })  // открывает
win.open('itemEditor', { id: 42 })  // то же окно, поднято наверх
win.open('itemEditor', { id: 43 })  // другая сущность, второе окно
```

## 3 · Открыть окно вне компонента

`useWindows()` работает в обычных модулях, навигационных guard'ах и сервисных файлах:

```js
// notifications.js
import { useWindows } from '@korneevecin/vue3-dialogs-lib'

export function onServerAlert(alert) {
  useWindows().open('logViewer', { source: alert.source }, { title: `Alert ${alert.id}` })
}
```

## 4 · Написать содержимое окна

`WindowHost` передаёт вашему компоненту `props` дескриптора плюс `windowId`.

```vue
<script setup>
import { useWindowContext } from '@korneevecin/vue3-dialogs-lib'

const props = defineProps({ id: Number, windowId: String })
const { setTitle, minimize, close, descriptor, isRestored } = useWindowContext()

setTitle(`Item ${props.id}`)
</script>

<template>
  <p>Редактируем элемент {{ props.id }}</p>
  <button @click="minimize()">Свернуть</button>
  <button @click="close()">Готово</button>
</template>
```

## 5 · Черновик, переживающий сворачивание и перезагрузку

Свёрнутое значит размонтированное, поэтому локальные `ref` исчезают. Положите черновик в дескриптор:

```vue
<script setup>
import { useWindowState } from '@korneevecin/vue3-dialogs-lib'

const props = defineProps({ windowId: String })

const form = useWindowState(props.windowId, () => ({ name: '', note: '' }))
</script>

<template>
  <input v-model="form.name" />
  <textarea v-model="form.note" />
</template>
```

`form` реактивен, является частью сохраняемого дескриптора и обязан оставаться сериализуемым в JSON.

## 6 · Загружать данные самому и обрабатывать устаревший черновик

Окно переживает представление, которое его открыло, поэтому его props — **только идентификаторы и
примитивы**, а содержимое загружает данные само. При восстановленном монтировании сервер мог уйти
вперёд:

```vue
<script setup>
import { onMounted, ref } from 'vue'
import { useWindowContext, useWindowState } from '@korneevecin/vue3-dialogs-lib'

const props = defineProps({ id: Number, windowId: String })
const form = useWindowState(props.windowId, () => ({ name: '' }))
const { descriptor, isRestored } = useWindowContext()

const conflict = ref(false)
const server = ref(null)

onMounted(async () => {
  const item = await api.get(`/items/${props.id}`)

  if (!isRestored) {
    // свежее открытие: засеять черновик и запомнить версию, с которой он начался
    form.name = item.name
    descriptor.meta.version = item.version
    return
  }

  // восстановленный черновик: сравнить с тем, что у сервера сейчас
  server.value = item
  conflict.value = item.version !== descriptor.meta.version
})

function takeServerCopy() {
  form.name = server.value.name
  descriptor.meta.version = server.value.version
  conflict.value = false
}
</script>

<template>
  <p v-if="conflict">
    Этот элемент изменился, пока ваш черновик был свёрнут.
    <button @click="conflict = false">Оставить мой черновик</button>
    <button @click="takeServerCopy">Взять серверную копию</button>
  </p>
</template>
```

Библиотека даёт вам `meta` и `isRestored` и на этом останавливается — она никогда ничего не
загружает, поэтому и разрешить конфликт за вас не может.

## 7 · Таскбар собственного дизайна

`WindowTaskbar` сам не рендерит ничего:

```vue
<WindowTaskbar v-slot="{ windows, restore, close }">
  <div v-if="windows.length" class="taskbar">
    <button v-for="w in windows" :key="w.id" @click="restore(w.id)">
      {{ w.title || w.name }}
      <span role="button" aria-label="Закрыть окно" @click.stop="close(w.id)">✕</span>
    </button>
  </div>
</WindowTaskbar>
```

`windows` — это множество свёрнутых окон (полные дескрипторы, поэтому `w.meta` и `w.state` доступны
для бейджей или пометок о несохранённых изменениях). Для настоящего таскбара — все окна, с
отмеченным сфокусированным — используйте `all` и `active`:

```vue
<WindowTaskbar v-slot="{ all, active, restore, focus, requestClose, registerFocusTarget }">
  <div v-if="all.length" :ref="registerFocusTarget" class="taskbar" tabindex="-1">
    <button
      v-for="w in all"
      :key="w.id"
      :class="{ active: w.id === active, minimized: w.minimized }"
      @click="w.minimized ? restore(w.id) : focus(w.id)"
    >
      {{ w.title || w.name }}
      <span role="button" aria-label="Закрыть окно" @click.stop="requestClose(w.id)">✕</span>
    </button>
  </div>
</WindowTaskbar>
```

`requestClose` запускает guard'ы, `close` — нет. Добавьте `closing` в слот-пропсы, чтобы показать,
что guard ещё думает: `<span v-if="closing(w.id)">…</span>` вместо ✕.

`registerFocusTarget` — подписка для тех, кто работает с клавиатуры. Сворачивание окна размонтирует
его, поэтому его фокус должен куда-то уйти: обычно на заголовок следующего окна, но если это было
последнее окно, следующего нет, и фокус иначе откатился бы к тому, что его открыло, — часто далеко
от кнопки таскбара, в которую окно только что превратилось. Привязка через template ref делает
получателем фокуса таскбар. Чтобы принять фокус, он должен быть фокусируемым, отсюда
`tabindex="-1"`; уберите привязку — и запасным вариантом останется открыватель. При *закрытии* окна
он не спрашивается: кнопки, которую можно было бы сфокусировать, уже нет.

## 8 · Свой заголовок, кнопки управления и подвал

Библиотека не поставляет строк, поэтому подписи и `aria-label` — ваши. Все три слота передают
дескриптор и применяются к каждому окну:

```vue
<script setup>
import { WindowHost, useWindows } from '@korneevecin/vue3-dialogs-lib'

const win = useWindows()
</script>

<template>
<WindowHost>
  <template #header="{ descriptor }">
    <img :src="iconFor(descriptor.name)" alt="" width="16" />
    <strong>{{ descriptor.title }}</strong>
    <input v-model="descriptor.meta.search" data-vw-nodrag placeholder="Фильтр…" />
  </template>

  <template #controls="{ descriptor }">
    <button aria-label="Свернуть окно" @click="win.minimize(descriptor.id)">–</button>
    <button aria-label="Закрыть окно" @click="win.close(descriptor.id)">✕</button>
  </template>

  <template #footer="{ descriptor }">
    <button @click="win.requestClose(descriptor.id)">Отмена</button>
    <button @click="save(descriptor)">Сохранить</button>
  </template>
</WindowHost>
</template>
```

`data-vw-nodrag` на любом элементе заголовка не даёт ему начать перетаскивание, поэтому поля ввода и
кнопки ведут себя нормально.

Подвал — это прилипшая строка под телом окна: окно устроено как `header / body / footer`, и
прокручивается только `.vw__body`. Поэтому содержимое выше рамки остаётся внутри рамки, а
уменьшение окна ручкой съедает область прокрутки, а не выталкивает кнопки за пределы видимости. Слот
по содержимому относится к конкретному окну, но в разметке он глобальный, поэтому ветвитесь по
дескриптору, если подвал нужен только некоторым окнам:

```vue
<template #footer="{ descriptor }">
  <template v-if="descriptor.name === 'itemEditor'">…</template>
</template>
```

Не указывайте слот вовсе — и элемент `.vw__foot` не отрисуется совсем, а тело займёт всю высоту
рамки. Базовая таблица стилей даёт `.vw__foot` верхнюю границу и отступ `--vtd-foot-pad`; и то и
другое косметика, само прилипание задано инлайново.

## 9 · Перекрасить всё

`style.css` — только косметика, и он лишь *читает* свойства `--vtd-*`. Задавайте их на любом уровне
выше окон — ничто в библиотеке не объявляет их на `.vw`, поэтому борьбы за специфичность не будет:

```css
:root {
  --vtd-font: system-ui, sans-serif;
  --vtd-font-size: 14px;
  --vtd-radius: 2px;
  --vtd-border: 2px solid #4338ca;
  --vtd-shadow: 0 12px 40px rgba(67, 56, 202, 0.45);
  --vtd-bg: #fff;
  --vtd-fg: #111;
  --vtd-accent: #4338ca; /* кольцо фокуса на заголовке */
  --vtd-head-bg: #4338ca;
  --vtd-head-fg: #fff;
  --vtd-head-pad: 6px 8px;
  --vtd-body-pad: 12px;
  --vtd-foot-pad: 8px 12px;
  --vtd-btn-hover-bg: rgba(255, 255, 255, 0.2);
  --vtd-scrollbar-thumb: rgba(17, 17, 17, 0.3); /* ползунок, дорожка; `thin` — узкая полоса */
  --vtd-scrollbar-track: transparent;
  --vtd-scrollbar-width: auto;
}

/* класс темы работает так же — обычное наследование */
.theme-dark { --vtd-bg: #0b1120; --vtd-head-bg: #020617; }

/* по типу окна, через имя, под которым вы его зарегистрировали */
.vw:has(.log-viewer) { --vtd-head-bg: #0f172a; }
```

Всё незаданное сохраняет умолчание библиотеки, поэтому приложение может стилизовать два свойства и
унаследовать остальные — включая умолчания тёмной темы. Переключение темы во время работы — это
`document.documentElement.style.setProperty('--vtd-head-bg', '#4338ca')`; удаление свойства
возвращает умолчание.

Не импортируйте таблицу вовсе — окна всё равно будут работать: раскладка и позиционирование заданы
инлайново.

### Готовые палитры и переключение во время работы

Блок `--vtd-*` выше — это и есть тема, поэтому библиотека поставляет двадцать две готовые палитры,
заполненные по опубликованным спецификациям: `dracula`, `nord`, `solarized-light`, `solarized-dark`,
`gruvbox-dark`, `catppuccin-latte`, `catppuccin-frappe`, `catppuccin-macchiato`, `catppuccin-mocha`,
`tokyo-night`, `one-dark`, `one-light`, `monokai`, `monokai-pro`, `rose-pine`, `everforest-dark`,
`kanagawa-wave`, `github-light`, `github-dark`, `ayu-dark`, `material-darker`, `nightfox`.

Одна тема — один импорт:

```js
import '@korneevecin/vue3-dialogs-lib/style.css'
import '@korneevecin/vue3-dialogs-lib/themes/nord.css'
```

```html
<html data-vtd-theme="nord">
```

Для переключателя импортируйте их все один раз и меняйте один атрибут — без повторного импорта,
без перезагрузки и без пропа на каждом окне:

```vue
<script setup>
import { ref, watchEffect } from 'vue'
import '@korneevecin/vue3-dialogs-lib/themes/all.css'

const THEMES = ['dracula', 'nord', 'solarized-light', 'catppuccin-mocha', 'github-dark']
const theme = ref('')

watchEffect(() => {
  const root = document.documentElement
  if (theme.value) root.setAttribute('data-vtd-theme', theme.value)
  else root.removeAttribute('data-vtd-theme') // назад к умолчаниям библиотеки
})
</script>

<template>
  <select v-model="theme">
    <option value="">По умолчанию</option>
    <option v-for="name in THEMES" :key="name" :value="name">{{ name }}</option>
  </select>
</template>
```

`.vtd-theme-nord` — то же самое правило, что и `[data-vtd-theme="nord"]`, поэтому класс работает
там, где класс удобнее, — в том числе на одном окне: у `BaseWindow` один корневой элемент, и `class`
проваливается на него.

Палитра достаёт только до окон. Страница сохраняет свой фон, свои полосы прокрутки и свои элементы
форм даже когда атрибут стоит на `<html>`: тема никогда не объявляет `color-scheme` сама — она задаёт
`--vtd-color-scheme`, а `style.css` применяет его на `.vw`. Там же окрашивается и полоса прокрутки
самого окна — из цвета текста рамки, поэтому она следует палитре, а не просто переключается между
светлой и тёмной полосой браузера; переопределяется через `--vtd-scrollbar-thumb`,
`--vtd-scrollbar-track` и `--vtd-scrollbar-width`. Всё, что вы рисуете сами, и в первую
очередь панель окон, лежит вне CSS библиотеки и сохраняет свои цвета; читайте те же токены, чтобы
подключить её к палитре:

```css
.taskbar {
  background: var(--vtd-head-bg, #26262b);
  color: var(--vtd-head-fg, #e5e7eb);
  color-scheme: var(--vtd-color-scheme, inherit);
}
```

Ещё два замечания. Палитры задают только цвета — `--vtd-radius`, токены `*-pad`, `--vtd-font` и
`--vtd-motion-duration` не трогаются, поэтому выбор палитры не отменяет вашу геометрию. И каждая
палитра обёрнута в `:where()`, то есть держится на нулевой специфичности: блок из начала этого
рецепта по-прежнему перебивает палитру, так что «Gruvbox, но с прямыми углами и своим акцентом» —
это

```css
:root {
  --vtd-radius: 0;
  --vtd-accent: #fe8019;
}
```

поверх `data-vtd-theme="gruvbox-dark"`, без единого `!important`.

## 10 · Отдать ESC вашему содержимому

ESC сворачивает сфокусированное окно. Компонент, которому ESC нужен для собственного выпадающего
списка, забирает его первым:

```vue
<script setup>
function onKeydown(e) {
  if (e.key === 'Escape' && open.value) {
    e.preventDefault()   // окно остаётся открытым
    open.value = false
  }
}
</script>

<template>
  <div @keydown="onKeydown">…</div>
</template>
```

## 11 · Сохранять не в localStorage

`storage` — это любой объект `{ getItem, setItem, removeItem }`:

```js
// на вкладку, а не на браузер
persist: { key: 'app:windows', storage: sessionStorage }
```

```js
// с серверным хранением, сквозная запись с кэшированным чтением
const remote = {
  cache: localStorage.getItem('app:windows'),
  getItem() { return this.cache },
  setItem(key, value) {
    this.cache = value
    localStorage.setItem(key, value)
    navigator.sendBeacon('/api/layout', value)
  },
  removeItem(key) { this.cache = null; localStorage.removeItem(key) },
}

createWindows({ components, persist: { key: 'app:windows', storage: remote } })
```

Записи отложены примерно на 300ms, поэтому сетевой адаптер не долбят на каждое нажатие клавиши.

## 12 · Закрыть всё при выходе из системы

```js
import { useWindows } from '@korneevecin/vue3-dialogs-lib'

export function logout() {
  useWindows().closeAll()             // черновики предыдущего пользователя исчезли
  localStorage.removeItem('app:windows')
  router.push('/login')
}
```

`closeAll()` очищает стек; удаление ключа хранилища не даёт раскладке вернуться после перезагрузки.

## 13 · Управлять стеком самому

```js
const win = useWindows()

win.s.stack        // все дескрипторы, в порядке создания
win.visible.value  // несвёрнутые
win.minimized.value
win.byId(id)

win.focus(id)
win.setTitle(id, 'Новый заголовок')
win.setGeometry(id, { x: 0, y: 0, w: 900, h: 600 })
win.clampAll({ w: window.innerWidth, h: window.innerHeight })
win.isRestored(id)
```

Пример — кнопка «разложить всё плиткой», раз уж библиотека тайлинга не поставляет:

```js
function tile() {
  const open = win.visible.value
  const w = Math.floor(window.innerWidth / open.length)
  open.forEach((d, i) => win.setGeometry(d.id, { x: i * w, y: 0, w, h: window.innerHeight }))
}
```

## 14 · Тестировать окна в своём приложении

Стор не зависит от DOM, поэтому большинству проверок браузер не нужен:

```js
import { createWindows, useWindows } from '@korneevecin/vue3-dialogs-lib'
import { mount } from '@vue/test-utils'

const plugin = createWindows({ components: { editor: ItemEditor } })
const wrapper = mount(App, { global: { plugins: [plugin] } })
const win = useWindows()

const { id } = win.open('editor', { id: 1 })
win.minimize(id)
await nextTick()
expect(wrapper.find('dialog.vw').exists()).toBe(false)   // содержимое действительно размонтировано
```

В jsdom `HTMLDialogElement.show()` отсутствует — добавьте двухстрочный shim в setup-файл (см.
`src/__tests__/setup.ts`) или запускайте набор тестов в настоящем браузере.

## 15 · Не дать закрыть окно с несохранённым черновиком

Guard'а два, и пройти должны оба. Тот, что относится к окну, живёт в содержимом, поэтому это
естественное место для вопроса «грязна ли эта форма»:

```vue
<script setup>
const { onBeforeClose } = useWindowContext()
const form = useWindowState(props.windowId, () => ({ name: '' }))

onBeforeClose(() => !form.name || confirm('Отбросить черновик?'))
</script>
```

Он снимается с регистрации, когда содержимое размонтируется, — а именно это и делает сворачивание.
Поэтому свёрнутое окно прикрыто только общим для приложения guard'ом, который видит дескриптор и его
сохранённый черновик:

```js
createWindows({
  components,
  beforeClose: (d) => !d.state?.name || confirm(`Отбросить черновик в ${d.title}?`),
})
```

Guard может быть асинхронным, и `requestClose` его ожидает — именно это и делает возможным
«спросить, потом решить»:

```js
const { onBeforeClose, closing } = useWindowContext()

onBeforeClose(async () => {
  if (!form.name) return true
  return await confirmSomehow(`Отбросить черновик в ${descriptor.title}?`)
})
```

`closing` — вычисляемое свойство, истинное, пока вопрос висит, для состояния ожидания на ваших
собственных кнопках; стандартные ✕ и – библиотеки блокируют себя сами. Повторный клик по ✕
присоединяется к тому же запросу, а не спрашивает второй раз, а guard, бросивший исключение,
оставляет окно открытым.

Guard'ы запускаются при `requestClose(id)` и по кнопке ✕. Они намеренно *не* запускаются из
`close(id)`, `closeAll()` и при вытеснении по `maxWindows`: выход из системы не должен быть
блокируемым, а вытеснение бесшумно по замыслу. Если потерять черновик самого старого окна важно,
поднимите `maxWindows` или следите за этим:

```js
win.on('close', (e) => saveDraftSomewhere(e.id))
```

## 16 · Дать типу окна собственные умолчания

Повторять один и тот же размер и флаги в каждом месте вызова — это режим отказа. Положите их в
компонент:

```js
createWindows({
  components: {
    itemEditor: { component: () => import('./windows/ItemEditor.vue'), w: 720, h: 520, minW: 320 },
    confirmBox: { component: ConfirmBox, w: 380, h: 180, resizable: false, minimizable: false },
    logViewer: () => import('./windows/LogViewer.vue'),   // голый компонент: умолчания библиотеки
  },
})
```

Опции `open()` по-прежнему побеждают эти, а эти побеждают умолчания библиотеки. Поскольку флаги
оказываются в дескрипторе, они переживают перезагрузку вместе с окном.

## 17 · Проверять типы `open()` по вашим компонентам

```ts
// windows.ts
import { useWindows } from '@korneevecin/vue3-dialogs-lib'

export const components = {
  itemEditor: () => import('./windows/ItemEditor.vue'), // defineProps<{ id: number }>()
  logViewer: () => import('./windows/LogViewer.vue'),
}
export const useAppWindows = () => useWindows<typeof components>()
```

```ts
import { useAppWindows } from './windows'

const win = useAppWindows()
win.open('itemEditor', { id: 42 })  // ок
win.open('itemEditor', { id: 'x' }) // ошибка
win.open('typo', {})                // ошибка
```

Импортируйте алиас везде; у голого `useWindows()` нет карты, по которой можно проверять. `windowId`
поставляется хостом и передавать его нельзя. Это фича уровня типов — вызов в рантайме идентичен, а
окно, чьи props вывести нельзя, просто откатывается к `Record<string, unknown>`.

Та же карта типизирует то, *чем окно разрешается*, если это объявлено в его спецификации. Маркер
существует только в типах и вырезается, прежде чем сможет добраться до дескриптора:

```ts
export const components = {
  itemEditor: {
    component: () => import('./windows/ItemEditor.vue'),
    result: null as unknown as SavedItem, // никогда не читается; существует ради вывода типа
  },
}

const saved = await useAppWindows().open('itemEditor', { id: 42 }).result
saved.ok && saved.data.name // SavedItem
```

Тип окна без маркера разрешается значением `unknown` — ровно так же, как невыводимые props
деградируют до `Record<string, unknown>`.

## 18 · Реагировать на переходы окон

```js
const off = win.on('*', (e) => analytics.track(`window:${e.type}`, { id: e.id }))
// 'open' | 'close' | 'focus' | 'minimize' | 'restore' | 'geometry' | 'title' | '*'
```

События покрывают только переходы стора. `geometry` сообщает об одном событии на жест —
перетаскивание, изменение размера или сдвиг стрелкой, в конце жеста — плюс `snap()` и
`setGeometry()`; промежуточные кадры и изменение черновика пишутся прямо в дескриптор, минуя методы
стора, поэтому ни то ни другое событий не порождает. Если они вам нужны — наблюдайте за дескриптором
сами. Возврат стека в уменьшившийся вьюпорт тоже бесшумен: это браузер двигает окна, а не
пользователь.

## 19 · Сказать что-нибудь, пока окно грузится, и когда оно упало

Компонент окна — это чанк. Дайте медленному случаю спиннер, а сломанному — сообщение; оба компонента
ваши и регистрируются по типу или на всё приложение:

```js
createWindows({
  components: {
    // По типу: этот большой, поэтому у него собственный спиннер и дедлайн.
    report: {
      component: () => import('./windows/Report.vue'),
      loadingComponent: WindowLoading,
      delay: 0,        // мс до появления спиннера; умолчание Vue — 200
      timeout: 8000,   // мс, после которых загрузка считается неудачной
    },
    itemEditor: () => import('./windows/ItemEditor.vue'),
  },
  // Общий запасной вариант для каждого типа, который не назвал собственный.
  async: { errorComponent: WindowError },
})
```

Значения на уровне типа побеждают ключ за ключом: `report` выше сохраняет общий `errorComponent`,
переопределяя спиннер. Они настраивают компонент, а не окно — их нельзя передать в `open()`, и они
никогда не попадают в дескриптор, поэтому ничего из этого не сохраняется.

Компонент ошибки получает саму ошибку и покрывает оба отказа: чанк, который так и не приехал, и
содержимое, которое упало, когда приехало:

```vue
<script setup>
defineProps({ error: { type: null, default: null } })
</script>

<template>
  <p>Не удалось загрузить: {{ error?.message }}</p>
  <button type="button" @click="$emit('retry')">Попробовать снова</button>
</template>
```

Окно, чьё содержимое упало, сохраняет свою рамку: заголовок, элементы управления и геометрия живы,
поэтому пользователь может отодвинуть его или закрыть, а `data-vw-error` на `<dialog>` позволяет его
стилизовать. Падение одного окна никогда не задевает остальные: `BaseWindow` перехватывает ошибку и
останавливает её на месте, вместо того чтобы дать ей дойти до `WindowHost` и уронить весь рабочий
стол. Из-за этой же локализации ошибка не доходит до `app.config.errorHandler` — сообщайте о ней из
своего компонента ошибки, если нужна централизация.

Если `errorComponent` не зарегистрирован, тело просто пусто — своих строк библиотека не поставляет,
— то есть окно работает, но пустое. Зарегистрируйте компонент.

## 20 · Задать вопрос в отдельном окне

Guard закрытия может сказать «подожди», но ему нужно чем-то спросить. Откройте окно, принадлежащее
тому, которое спрашивает:

```js
const { result } = win.open('confirmSheet', { message }, { owner: props.windowId })
```

Окно с владельцем рисуется прямо над своим владельцем и ставит `inert` на `<dialog>` владельца — и
больше ни на что. Нет ни подложки на всю страницу, ни top layer, ни focus trap: все *остальные* окна
рабочего стола остаются полностью интерактивными, включая перетаскивание. Это document-modal sheet
из macOS, а не `showModal()`.

Что библиотека с этим делает, и ничего из этого устраивать не надо:

- пара двигается как группа — фокус на любом поднимает оба, и ребёнок всегда на один `z` выше
  владельца;
- `minimize(owner)` и `requestClose(owner)` отклоняются, пока ребёнок открыт, поскольку ребёнок *и
  есть* вопрос; `close(owner)` сначала закрывает ребёнка, затем владельца;
- ESC отклоняет ребёнка вместо того, чтобы его свернуть, а инертный владелец эту клавишу вообще не
  получает;
- ребёнок всегда `closable`, никогда не `minimizable`, пропускает дедупликацию, не учитывается в
  `maxWindows` и ничего не вытесняет ради места;
- он **никогда не сохраняется**: подтверждение не должно возвращаться после перезагрузки. Связь
  живёт в рантайм-карте, поэтому ничто из неё не доходит ни до дескриптора, ни до `SCHEMA`.

Цепочка может быть глубиной в три звена — лист может владеть листом, — а запрос четвёртого бросает
исключение в `open()`, как и неизвестный id владельца.

Ответ — это собственный result листа (рецепт 21), и именно это делает безопасным его ожидание:
**лист может исчезнуть, не ответив** — ESC его отклоняет, закрытие владельца утаскивает его с
собой, — и каждый из этих путей разрешает `{ ok: false }`, поэтому вопрос без ответа читается как
«оставить окно», а не подвешивает guard навсегда.

```js
// внутри листа
const { resolve } = useWindowContext()
// <button @click="resolve(true)">Отбросить</button>

// внутри окна, которое спрашивает
async function ask(message) {
  const answer = await win.open('confirmSheet', { message }, { owner: props.windowId }).result
  return answer.ok && answer.data
}

onBeforeClose(async () => !form.name || (await ask(`Отбросить черновик в ${descriptor.title}?`)))
```

Где появится лист — решать вам: передайте `x`/`y` из дескриптора владельца, чтобы поставить его над
спросившим окном, а не отправить в каскад:

```js
{ owner: props.windowId, x: Math.round(descriptor.x + descriptor.w / 2 - 160), y: descriptor.y + 48 }
```

`win.ownerOf(id)`, `win.childrenOf(id)` и `win.hasChild(id)` отвечают на остальное — таскбару обычно
нужен `all.filter((w) => !win.ownerOf(w.id))`, поскольку лист принадлежит своему владельцу, а не
рабочему столу.

## 21 · Дождаться того, что произвело окно

`open()` возвращает `{ id, result }`. Result — это промис, который окно разрешает из собственного
содержимого:

```vue
<script setup>
import { useWindowContext } from '@korneevecin/vue3-dialogs-lib'

const { resolve, dismiss } = useWindowContext()

async function save() {
  const item = await api.save(form)
  resolve(item)   // разрешает { ok: true, data: item }, затем закрывает окно
}
</script>

<template>
  <button type="button" @click="save">Сохранить</button>
  <button type="button" @click="dismiss()">Отмена</button>
</template>
```

```js
const saved = await win.open('itemEditor', { id: 42 }).result
if (saved.ok) list.replace(saved.data)
else console.log('пользователь не сохранил:', saved.reason) // 'closed' | 'restored'
```

`resolve()` и `dismiss()` безусловны, как и `close()`: содержимое только что приняло решение,
поэтому его собственному guard'у закрытия спрашивать уже не о чем. Используйте `requestClose()`,
когда закрыть попросил *пользователь* и guard должен отработать.

**Промис никогда не зависает.** Всё, что убирает окно, его разрешает: ✕, `close()`, `closeAll()`,
вытеснение по `maxWindows`, владелец, закрывающий своего ребёнка. Чего он не делает, так это не
разрешает промис раньше времени: guard закрытия, который отказал, оставляет окно открытым, а вместе
с ним и вопрос.

Две вещи, которые стоит знать:

- **Восстановленное окно разрешается как `restored`.** Его открыватель принадлежит предыдущей
  загрузке страницы, поэтому отвечать некому. `win.resultOf(id)` даёт промис для любого открытого
  окна — гидратированное уже разрешено, а id, которого в сторе больше нет, отвечает `closed`.
- **Ничто из результата не сохраняется.** Он живёт в рантайм-карте рядом с guard'ами закрытия.
  Поэтому окно может разрешиться чем угодно, сериализуемым или нет, — но его `props` и `state`
  по-прежнему поля дескриптора и по-прежнему обязаны пережить `JSON.stringify`.

Ожидание *защищённого* закрытия — вторая половина той же идеи и то, что делает рецепт 20: result
листа и есть ответ guard'а.

## 22 · Убрать клавиатурные сокращения с дороги

Каждое действие поставляется с двумя аккордами: привычным (`Meta`+стрелка, `` Alt+` ``) и таким,
который переживает оконный менеджер (`Ctrl`+`Shift`+стрелка, `Ctrl`+`Shift`+`1`…`4`, `` Ctrl+` ``).
Привычный обычно перехватывается выше браузера — Snap Assist в Windows, тайлинг в GNOME и KDE,
переключение группы в GNOME, «Назад» в Chrome на macOS, — чего страница не может ни увидеть, ни
предотвратить, поэтому большинство пользователей на самом деле будут нажимать второй аккорд.

Если любой из них конфликтует с вашим приложением, перенесите его. Переопределение заменяет **оба**
умолчания для этого действия, поэтому вы никогда не унаследуете ту половину, которую не назвали:

```js
app.use(createWindows({
  components,
  keymap: {
    bindings: {
      snapLeft: 'Ctrl+Shift+BracketLeft',   // один аккорд, заменяющий оба умолчания
      snapRight: 'Ctrl+Shift+BracketRight',
      snapMax: ['Ctrl+Shift+ArrowUp', 'F11'], // или несколько
      snapTopLeft: null,          // отвязать четверти, которые не нужны
      snapTopRight: null,
      snapBottomLeft: null,
      snapBottomRight: null,
    },
  },
}))
```

Действие принимает один аккорд, массив аккордов или `null`, чтобы отвязать его. Всё неупомянутое
сохраняет оба своих умолчания, а `keymap: { enabled: false }` убирает всё разом — включая то, что вы
никогда не переназначали.

Ничто здесь не скажет вам, доходит ли аккорд до страницы на машинах ваших пользователей, потому что
перехваченная клавиша не порождает события вообще. Если вы делаете интерфейс переназначения,
считывайте аккорд из настоящего `keydown`: аккорд, который съедает оконный менеджер, записать
невозможно, поэтому то, что пользователю удалось нажать, по построению работает.

Переключение окон доступно в любом случае, так что его можно повесить на собственное сокращение:

```js
const win = useWindows()

useEventListener(window, 'keydown', (e) => {
  if (e.key !== 'Tab' || !e.ctrlKey) return
  e.preventDefault()
  if (e.shiftKey) win.focusPrev()
  else win.focusNext()
})
```

`focusNext()` поднимает окно, на которое попадает, фокусирует его заголовок и возвращает id — или
`null`, когда фокусировать нечего. Свёрнутые окна пропускаются, как и окно, владеющее ребёнком:
владелец `inert`, пока его вопрос открыт, а ребёнок прямо над ним — та половина пары, до которой
клавиатура дотягивается.

Три вещи, которые стоит знать о том, как доставляются аккорды:

- **Один слушатель, на документе, действующий на активное окно.** Не по одному на окно: `<dialog>`
  не фокусируем, как и большая часть содержимого окна, поэтому слушатель на окне глохнет в тот
  момент, когда пользователь кликает по тексту в теле окна или по фону страницы. То, что сверху, —
  окно с `data-vw-active` — и есть то, на что действует аккорд, где бы ни оказался фокус.
- **Нажатие внутри текстового поля принадлежит текстовому полю.** `<input>`, `<textarea>` и
  `contenteditable` никогда не доходят до раскладки клавиш нигде на странице, потому что `Meta`+`←`
  на macOS — это начало строки, а `Ctrl`+`Shift`+стрелка везде — выделение по словам. Содержимое,
  которому нужна любая другая клавиша для себя, вызывает `preventDefault()` — тот же аварийный люк,
  что и у ESC в рецепте 10: слушатель висит на фазе всплытия, поэтому ваши обработчики отрабатывают
  первыми.
- **Всё это привязано к приложению, а не к времени жизни страницы.** Слушатель живёт в effect scope
  плагина рядом с трекером вьюпорта, поэтому `app.unmount()` уносит его с собой, а без DOM не
  привязывается вообще ничего.

## 23 · Задать вопрос, на который должен ответить весь рабочий стол

Лист из рецепта 20 блокирует ровно одно окно — то, которое спросило. Когда вопрос про рабочий стол,
а не про документ, открывайте его модальным:

```js
const answer = await win.open('confirm', { message }, { modal: true }).result
```

Страница позади приглушается затемнением, `<dialog>` каждого другого окна становится `inert`, а
модальное окно рисуется выше и полосы закреплённых окон, и призрака примагничивания. Это по-прежнему
`show()`, а не `showModal()`: браузерного top layer нет, поэтому ваш таскбар, `zIndexBase` и
анимация ухода продолжают работать, а рабочий стол без открытых модальных окон — ровно тот же
рабочий стол, что был.

|  | Лист — `{ owner: id }` | Модальное — `{ modal: true }` |
| --- | --- | --- |
| Область действия | одно окно: его владелец | рабочий стол |
| Что становится инертным | собственный `<dialog>` владельца | все остальные окна |
| Подложка | нет | одно затемнение, под верхним модальным окном |
| Другие окна | полностью рабочие, включая перетаскивание | инертны |
| Где находится | на один `z` выше владельца | верхняя полоса, выше закреплённых |
| ESC | отклоняет | отклоняет |
| Сохраняется | никогда | никогда |

Оба разрешают результат на любом пути, который их убирает, поэтому вопрос без ответа читается как
«нет», а не подвешивает вызывающего — см. рецепт 21.

Дайте этой форме имя один раз, вместо того чтобы расписывать её в каждом месте вызова:

```js
app.use(createWindows({
  components,
  presets: {
    dialog: { modal: true, placement: 'center', w: 420, h: 200,
              draggable: false, resizable: false },
  },
}))

const ok = await win.open('confirm', { message }, { preset: 'dialog' }).result
```

Пресет назван в месте вызова, поэтому он старше собственной спецификации компонента и уступает явным
опциям этого вызова: `open()` → пресет → спецификация → умолчание. Неизвестное имя бросает
исключение в `open()`.

Две вещи, которые решать вам, потому что библиотека ни по одной из них позиции не занимает:

- **Tab.** Затемнение останавливает указатель, и ничто не останавливает клавиатуру, поэтому Tab
  уходит из модального окна на вашу страницу. Направьте `modal: { inertRoot }` на элемент,
  содержащий содержимое вашей страницы, и он станет `inert`, пока открыто модальное окно:

  ```js
  createWindows({ components, modal: { inertRoot: '#page' } })
  ```

  Он не должен содержать `WindowHost`: `inert` покрывает поддерево, поэтому предок окон сделал бы
  некликабельным само модальное окно. Монтируйте хост рядом с содержимым страницы, а не внутри него.

- **Клик по затемнению.** Обработчика клика на нём нет вовсе. Если закрытие таким способом подходит
  вашему приложению — это две ваши собственные строки:

  ```js
  document.addEventListener('pointerdown', (e) => {
    if ((e.target as Element).classList.contains('vw-scrim')) void win.requestClose(win.topModalId())
  })
  ```

Оттенок задаётся `--vtd-scrim-bg` в необязательной таблице стилей (`rgba(0, 0, 0, 0.4)` и более
тёмное умолчание при `prefers-color-scheme: dark`). Позиция и наложение заданы на элементе
инлайново, поэтому модальное окно блокирует клики даже без импортированной таблицы стилей вовсе.
