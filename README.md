# ChaldLauncher

Minecraft-лаунчер от Chald Studio (Electron + React + TypeScript).

## Запуск и сборка

```
npm install
npm run dev        # разработка (Vite + Electron)
npm run build      # сборка
npm test           # тесты
npm run dist       # установщик (electron-builder)
```

## Загрузчики

Vanilla, Fabric, Quilt, Forge (Minecraft 1.13+) и NeoForge (1.20.2+, включая 26.x).
Forge/NeoForge устанавливаются самим лаунчером: он скачивает установщик, берёт библиотеки через свой список
разрешённых хостов и запускает обработчики установщика с помощью Java. Сами обработчики обращаются к серверам
Mojang напрямую, эти запросы не видны на вкладке «Сетевые запросы».

## Modrinth

Страница «Modrinth» в боковом меню: поиск и установка модов, сборок (`.mrpack`) и ресурспаков.

- **Мод / ресурспак** скачивается в выбранный инстанс. У модов автоматически ставятся обязательные зависимости; версия подбирается под Minecraft и загрузчик инстанса. Файл с тем же именем не перезаписывается.
- **Сборка** создаёт новый инстанс: лаунчер скачивает файлы по списку из сборки (проверка SHA-1), копирует `overrides/` и `client-overrides/`, затем ставит нужную версию Minecraft и загрузчик. При ошибке или отмене созданный инстанс удаляется.
- Запросы идут только на `api.modrinth.com` и `cdn.modrinth.com` (для сборок ещё GitHub/GitLab, как разрешает формат .mrpack) и видны на вкладке «Сетевые запросы».

## Шрифт

`src/renderer/fonts/ChaldPixel.woff` — Pixelify Sans с перерисованными «е/Е», «в», «О», «П» (в оригинале кириллический набор неполный, а «е» похожа на зеркальную «э»). Один файл покрывает латиницу и кириллицу.

## Вход через Microsoft

Лаунчеру нужен **свой** Azure Client ID. ID официального Minecraft Launcher использовать нельзя: он принадлежит
Mojang, не предназначен для чужих программ, и лаунчер выдавал бы себя за официальный.

1. portal.azure.com → Microsoft Entra ID → App registrations → New registration.
2. Supported account types: «Personal Microsoft accounts only» (или «Accounts in any ... and personal»).
3. Redirect URI: платформа «Mobile and desktop applications», значение `http://localhost`.
   Authentication → «Allow public client flows» = Yes (нужно для входа по коду).
4. Скопируй Application (client) ID.
5. Подай заявку на доступ к Minecraft API: https://aka.ms/AppRegInfo (без одобрения Mojang вход закончится ошибкой
   вида «Invalid app registration»).
6. Вставь ID в `src/main/config.ts` (`DEFAULT_MS_CLIENT_ID`), чтобы он работал у всех пользователей,
   либо введи его в Настройках → Аккаунт.

Вход идёт через системный браузер (PKCE, временный локальный порт). Если он недоступен, есть вход по коду.
Токены хранятся только в зашифрованном виде (safeStorage).
