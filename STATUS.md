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

## Обновление (гардероб + память)
- Память: ползунки Xmx/Xms (src/renderer/components/MemorySliders.tsx) в Настройках и в настройках инстанса («Как в настройках» / «Свой объём»); максимум ползунка = ОЗУ компьютера (IPC system:memory), предупреждения «больше ОЗУ» и «системе остаётся < 1,5 ГБ».
- Автоподбор: настройка memoryAuto (по умолчанию включена), src/shared/memory.ts: объём зависит от числа модов в инстансе и ОЗУ компьютера (системе остаётся max(2 ГБ, 30%), потолок 16 ГБ). При запуске (launcher.ts) своё значение инстанса главнее авто, авто главнее глобальных ползунков; выбранный объём пишется в лог игры.
- Гардероб: страница «Гардероб» (pages/Wardrobe.tsx), библиотека скинов в <dataDir>/wardrobe (src/main/wardrobe.ts), импорт PNG 64×64/64×32 с автоопределением Alex/Steve (src/main/png.ts + shared/skin.ts), плоский предпросмотр спереди/сзади из самого PNG, переименование, удаление. Для аккаунта Microsoft: «Надеть на аккаунт» (POST /minecraft/profile/skins), «Сохранить текущий скин» (GET профиль + textures.minecraft.net), «Сбросить на стандартный» (DELETE /minecraft/profile/skins/active). В офлайн-режиме скин не меняется (библиотека доступна).
- Проверено: typecheck (main + renderer), npm run build, 154 теста (новые: memory, skin, wardrobe [PNG-кодек, импорт, запросы к локальному серверу вместо Mojang], ui [SSR-рендер ползунков и страницы гардероба]).
- НЕ проверено: Electron вживую (вид, ползунки, предпросмотр на canvas), реальные запросы к api.minecraftservices.com / textures.minecraft.net (смена, сброс, сохранение текущего скина), запуск игры с автоподобранной памятью.

## Обновление (Modrinth «Установлено» + файл .chaldlauncher)
- Modrinth: вместо «Установить» для уже стоящего мода/ресурспака показывается «Установлено» (IPC modrinth:installed, listInstalledProjects по .chald-modrinth.json).
- Экспорт/импорт инстанса: src/main/chaldpack.ts. Файл .chaldlauncher = zip: chaldlauncher.json (версия игры, загрузчик, файлы Modrinth с SHA-1 и ссылкой cdn.modrinth.com) + overrides/ (всё, что скачать нельзя: свои моды, конфиги, options.txt, по желанию миры). При экспорте каждый файл сверяется с Modrinth по хэшу; изменённый или не найденный кладётся в overrides. Не экспортируются: логи, crash-reports, screenshots, кэши, настройки Java/памяти, аккаунт.
- Импорт: «Импорт» на странице «Инстансы» (chaldpack:inspect -> окно подтверждения с предупреждением про .jar -> chaldpack:import); экспорт: меню инстанса «Экспорт в файл» (chaldpack:export). Прогресс импорта виден в статусбаре.
- Защита при импорте: схема zod, ссылки только https://cdn.modrinth.com, пути только mods/ и resourcepacks/, лишние записи вне overrides/ отклоняются, лимит 1 ГБ / 20 000 файлов, проверка SHA-1 при скачивании.
- Проверено: typecheck, build, 162 теста (tests/chaldpack.test.ts: экспорт, круг экспорт→импорт, враждебные архивы). НЕ проверено: Electron вживую, реальные запросы к Modrinth при экспорте, импорт на чистой установке с настоящим Minecraft.
- Ограничения: архив собирается в памяти (adm-zip), поэтому предел 1 ГБ; отмены импорта в интерфейсе нет.

## Обновление (иконки модов, сетевые ошибки)
- Вкладка «Моды»: иконка и название берутся из самого .jar (Fabric/Quilt: поле icon; NeoForge/Forge: displayName и logoFile из mods.toml), без сети. Без иконки остаётся заглушка.
- Сеть: GET-запросы повторяются до 3 раз; вместо «fetch failed» понятное «Нет связи с <хост>: <причина>». Проверка совместимости загрузчика больше не обрывает установку, если список версий не удалось получить из-за сети (реальную ошибку покажет скачивание самого загрузчика).
- Тесты: 166 (tests/chaldpack.test.ts). НЕ проверено в живом Electron.

## Обновление (модуль обновления модов из другой сессии)
- src/main/modUpdates.ts (из другой сессии) подключён: добавлены недостающие типы InstalledMod/InstalledModsReport/ModUpdateInfo (shared/types.ts), экспорт INDEX_FILE, типы MrProjectLite/MrVersionDetail и методы ModrinthApi identify/latest/projectsLite/versionDetails/iconData (POST /version_files, /version_files/update, GET /projects).
- Проверено: tsc чисто, build, 170 тестов (tests/modupdates.test.ts, с подставным API). НЕ сделано: IPC-каналы, Services и интерфейс для обновления модов (в этой версии проекта их нет) и запросы к реальному Modrinth.

## Обновление (свой установщик)
- Добавлена папка `installer/`: отдельное Electron-приложение с окном в стиле лаунчера (ChaldPixel, тёмная тема). Страницы: выбор папки и ярлыков, прогресс, итог, ошибка. Ядро без внешних зависимостей: формат данных `.chpk` (deflate + SHA-256 на каждый файл, заголовок в конце), установка через временную папку и подмену, обновление существующей установки, отмена, тихий режим (`--silent`, `--dir`, `--no-desktop`, `--no-start-menu`, `--launch`), `uninstall.ps1` для «Приложения и возможности».
- В лаунчере: `build` в package.json (appId `studio.chald.launcher`, productName, icon), скрипты `dist:dir` и `installer`, иконка `resources/icon.ico`, `app.setAppUserModelId` в src/main/index.ts (совпадает с ярлыками установщика).
- Проверено: ядро установщика компилируется (tsc), 13 тестов node:test проходят (упаковка и распаковка, испорченный и обрезанный архив, враждебные пути, чистая установка, обновление, сбой при обновлении оставляет старую версию, отмена, предупреждения). Типы main/preload проверены только с заглушкой electron. Интерфейс отрисован в Chromium с подставным API (все страницы, без переполнения).
- НЕ проверено: запуск в настоящем Electron/Windows, создание ярлыков (shell.writeShortcutLink), запись в реестр через reg.exe, работа uninstall.ps1 в PowerShell, сборка electron-builder (portable), загрузка шрифта в окне установщика на Windows, поведение SmartScreen/антивируса. Путь данных пользователя в uninstall.ps1 (`%APPDATA%\ChaldLauncher`) предполагает, что userData лаунчера называется по productName.
