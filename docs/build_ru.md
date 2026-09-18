# Сборка и упаковка

Репозиторий разрабатывается на pnpm — поле `packageManager` в `package.json` фиксирует версию, так
что corepack подхватывает её сам. `pnpm-lock.yaml` — единственный lock-файл.

```sh
pnpm install
```

Ни у одной зависимости нет install-скрипта, поэтому блокировка build-скриптов в pnpm 10 никогда не
требует списка `onlyBuiltDependencies`. На хойстинг тоже ничего не полагается: если импорт вдруг
перестанет резолвиться, правильное решение — объявить настоящую зависимость, а не добавлять
`shamefully-hoist`.

## Сборка

```sh
pnpm build
```

Три стадии, по порядку:

1. `type-check` (`vue-tsc --build`) и `build-only` (`vite build`) параллельно, через `run-p`.
   `vite build` пишет ES-бандл в `dist/vue3-dialogs-lib.js`. Vue вынесен во внешние зависимости —
   бандл импортирует его, а не включает в себя.
2. `build-types` (`vue-tsc -p tsconfig.lib.json`) выпускает декларации в `dist/types/`.
3. `build-css` копирует `src/style.css` в `dist/style.css` и `src/themes/` в `dist/themes/` как есть.
   Это обычное копирование файлов, а не результат бандлера.

Стадии соединены через `&&`, поэтому **если `build-types` упадёт, `build-css` не выполнится и
`dist/` останется без стилей**. Сборка, напечатавшая ошибку `vue-tsc`, не дала пригодный к отправке
`dist/`, даже если бандл на месте.

Стилевой файл — только косметика. Структурная раскладка инлайновая, так что библиотека работает и
вовсе без подключённых стилей.

Ожидаемый результат:

```
dist/
  vue3-dialogs-lib.js
  style.css
  themes/
    all.css
    dracula.css
    ...
  types/
    index.d.ts
    ...
```

## Упаковка

```sh
pnpm pack
```

Пишет `korneevec-vue3-dialogs-lib-<версия>.tgz` в корень репозитория. Это локальная операция — она
не обращается к реестру и не является публикацией.

`prepack` сначала запускает `pnpm build`, поэтому в архиве всегда свежий `dist/`. Поле
`files: ["dist"]` отсекает всё остальное; `package.json`, `README.md` и `LICENSE` npm добавляет сам.
`src/`, `docs/`, `playground/` и тесты в архив не попадают.

Посмотреть содержимое:

```sh
tar -tzf korneevec-vue3-dialogs-lib-<версия>.tgz
```

Архивы игнорируются гитом (`*.tgz`).

## Проверка архива в другом проекте

Единственная проверка, которая доказывает, что `exports` и `types` указывают на существующие файлы:

```sh
mkdir /tmp/consume && cd /tmp/consume
pnpm init
pnpm add vue /путь/к/vue3-dialogs-lib/korneevec-vue3-dialogs-lib-<версия>.tgz
```

```js
import { createWindows } from '@korneevec/vue3-dialogs-lib'
import '@korneevec/vue3-dialogs-lib/style.css'
```

## Остальные команды

```sh
pnpm dev                      # playground в playground/, поверхность для проверки в браузере
pnpm exec vitest run          # оба тестовых проекта: unit (jsdom) и browser (Playwright)
pnpm exec vitest run --project unit
pnpm bench                    # бенчмарки в src/__bench__/
pnpm lint                     # eslint .
pnpm lint:fix
pnpm type-check               # vue-tsc --build
```

Браузерному тестовому проекту один раз нужен Chromium:

```sh
pnpm exec playwright install chromium
```

## Релиз

Релизы делаются вручную. Пакет scoped, и `publishConfig.access` уже стоит в `public`, так что весь
процесс такой:

```sh
# 1. поднять "version" в package.json (semver), закоммитить
# 2. посмотреть, что именно уйдёт в реестр — prepack сначала пересоберёт dist/
pnpm publish --dry-run
# 3. опубликовать
pnpm publish
# 4. пометить коммит тегом
git tag v<версия> && git push --tags
```

`pnpm publish` запускает `prepack`, поэтому `dist/` всегда пересобирается из релизного коммита;
ошибка `vue-tsc` прервёт публикацию до того, как что-либо будет загружено. Dry run печатает список
файлов — сверьте его с ожидаемым деревом `dist/` выше и убедитесь, что `LICENSE` и `README.md` в нём
есть.
