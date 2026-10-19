# ChaldLauncher — статус (WIP)

Проверено: npm run typecheck (main + renderer) проходит, npm run build проходит, npx vitest run: 77 тестов проходят (последний прогон тестов был до написания страниц renderer).
Не проверено: Electron вживую (визуально интерфейс не смотрели), установка с Mojang/Fabric, вход Microsoft, запуск игры.

## Готово
- Бэкенд полностью (см. прошлый статус) + офлайн-режим: accountMode/offlineName в настройках и схемах, offlineUuid (src/main/offline.ts), AuthService.setOffline/getLaunchAuth/refresh, IPC auth:setOffline, userType 'legacy', токен "0" не редактируется в логах. Тесты: tests/offline.test.ts.
- Client ID по умолчанию пустой, ID официального лаунчера не вшит.
- Renderer: tokens.css, app.css, pages.css, main.tsx, App.tsx (загрузка, страницы, мастер, окно device code), страницы Home, Instances, Versions, Content (моды/ресурспаки), Console, Settings, компоненты InstanceCard, InstancePanel, InstanceMenu (дублировать/изменить/удалить), EditInstance, CreateWizard, AccountSection.

## Осталось (по порядку)
1. README.md: как зарегистрировать приложение в Azure и подать заявку в Mojang (обязательно по ТЗ), запуск, сборка.
2. Тесты renderer: SSR-рендер страниц с замоканным window.chald (vitest: include 'tests/**/*.test.{ts,tsx}', environment node, useStore.setState + renderToString). Сейчас тестов на UI нет.
3. Убрать динамический import api в AccountSection (кнопка «Выйти»): импортировать call статически.
4. Сверить вид с макетом в живом окне (npm run dev с Electron): отступы, правая панель, сетка; в макете иконки модов на карточке не реализованы (в InstanceView нет данных).
5. Проверить пути ошибок: нет сети, отмена установки, Play без аккаунта (AUTH_REQUIRED ведёт в настройки).
6. Опционально: Forge/NeoForge через установщик, иконка приложения, конфиг electron-builder (resources/ есть).

## Обновление
- Исправлено: гонка событий при запуске процесса (панель застревала на «Подготовка библиотек…» с кнопкой «Остановить»), шрифт кириллицы (Pixelify Sans только для латиницы).
- Добавлено: вход через браузер (PKCE) + по коду, DEFAULT_MS_CLIENT_ID в src/main/config.ts, загрузчики Quilt/Forge/NeoForge (src/main/forgeInstall.ts), README.
- Проверено: типы main-процесса (со стабами electron/adm-zip), тесты tests/loaders.test.ts. НЕ проверено: Electron вживую, реальная установка Forge/NeoForge, вход Microsoft, запуск игры.

## Обновление (Modrinth + шрифт)
- Добавлено: src/main/modrinth.ts (поиск, подбор версии, зависимости, .mrpack), страница pages/Modrinth.tsx, IPC modrinth:*, хосты api/cdn.modrinth.com в net.ts, кнопка «Скачать с Modrinth» на страницах модов и ресурспаков.
- Шрифт ChaldPixel (исправлены е/Е, в, О, П) используется для всего интерфейса.
- Проверено: typecheck, build, 112 тестов (новые: tests/modrinth.test.ts, включая враждебный архив с выходом за папку). НЕ проверено вживую: запросы к реальному Modrinth, установка сборки, вид страницы в Electron.
- Client ID официального лаунчера не вшит: свой вводится в Настройках → Аккаунт или в config.ts.

## Обновление (шрифт + страница проекта Modrinth)
- ChaldPixel.woff: строчные «ь», «ы» теперь высотой строчных (раньше были как заглавные), у заглавной «К» убран лишний значок сверху, «ъ»/«Ъ» получили левый отступ, все цифры 0–9 перерисованы на общей пиксельной сетке (одинаковая ширина, 5 и 6 больше не похожи на S/G).
- Мелкий текст в CSS увеличен (11–13px -> 15px, 14px -> 16px): пиксельный шрифт читается чётко от ~16–17px.
- Modrinth: карточка открывается по клику на название или «Подробнее». Вкладки «Описание» (Markdown безопасно, без HTML и картинок) и «Версии» (тип, версии игры, загрузчики, дата, скачивания, размер, «Что нового»). Можно выбрать конкретную версию и установить её (зависимости ставятся сами). Кнопка «Открыть на сайте».
- Новые IPC: modrinth:project, modrinth:versions, modrinth:openPage; modrinth:install и modrinth:installPack принимают versionId.
- НЕ проверено: typecheck/vitest (нет node_modules в среде), вид в живом Electron, запросы к реальному Modrinth. Markdown-рендер проверен отдельно на «вредном» тексте.
