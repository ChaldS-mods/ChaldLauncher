#!/usr/bin/env bash
set -euo pipefail

# ============================================================
#  ChaldLauncher — установщик для Linux
#  https://github.com/ChaldS-mods/ChaldLauncher
# ============================================================

APP_NAME="ChaldLauncher"
REPO="ChaldS-mods/ChaldLauncher"
RELEASES_URL="https://github.com/${REPO}/releases/latest"
INSTALL_DIR="${HOME}/.local/share/${APP_NAME}"
BIN_DIR="${HOME}/.local/bin"
DESKTOP_DIR="${HOME}/.local/share/applications"
ICON_DIR="${HOME}/.local/share/icons/hicolor/256x256/apps"
DESKTOP_FILE="${DESKTOP_DIR}/${APP_NAME}.desktop"
SYMLINK="${BIN_DIR}/chaldlauncher"
APPIMAGE_PATH="${INSTALL_DIR}/${APP_NAME}.AppImage"
CURL_UA="Mozilla/5.0 (X11; Linux x86_64) ChaldLauncher-Installer/1.0"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BOLD='\033[1m'; NC='\033[0m'

ok()   { printf '%b\n' "${GREEN}[ok]${NC}    $*" >&2; }
warn() { printf '%b\n' "${YELLOW}[warn]${NC}  $*" >&2; }
fail() { printf '%b\n' "${RED}[fail]${NC}  $*" >&2; exit 1; }
step() { printf '%b\n' "${BOLD}==>${NC} $*" >&2; }

need_cmd() { command -v "$1" >/dev/null 2>&1 || fail "Не найдена команда: $1"; }

install_fuse2() {
    step "Проверка libfuse2 (нужен для AppImage)"
    if ldconfig -p 2>/dev/null | grep -q 'libfuse\.so\.2'; then
        ok "libfuse2 уже установлен"; return 0
    fi
    if [[ -f /usr/lib/x86_64-linux-gnu/libfuse.so.2 || -f /usr/lib64/libfuse.so.2 || -f /lib/x86_64-linux-gnu/libfuse.so.2 ]]; then
        ok "libfuse2 найден в системе"; return 0
    fi
    warn "libfuse2 не найден — устанавливаю..."
    if command -v apt-get >/dev/null 2>&1; then
        sudo apt-get update -qq
        if apt-cache show libfuse2t64 &>/dev/null; then
            sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq libfuse2t64
        else
            sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq libfuse2
        fi
        ok "libfuse2 установлен (apt)"
    elif command -v dnf >/dev/null 2>&1; then
        sudo dnf install -y -q fuse fuse-libs; ok "libfuse2 установлен (dnf)"
    elif command -v pacman >/dev/null 2>&1; then
        sudo pacman -S --noconfirm --needed fuse2; ok "libfuse2 установлен (pacman)"
    elif command -v zypper >/dev/null 2>&1; then
        sudo zypper --non-interactive install -y fuse libfuse2; ok "libfuse2 установлен (zypper)"
    else
        warn "Поставь libfuse2 вручную"; return 1
    fi
}

install_keyring() {
    step "Проверка keyring (нужен для сохранения аккаунта Microsoft после перезагрузки)"
    local need=false
    if ! command -v gnome-keyring-daemon >/dev/null 2>&1 && ! command -v kwalletd6 >/dev/null 2>&1 && ! command -v kwalletd5 >/dev/null 2>&1; then
        need=true
    fi
    if ! ldconfig -p 2>/dev/null | grep -q 'libsecret-1\.so'; then
        need=true
    fi
    if ! $need; then
        ok "keyring / libsecret уже есть"
        return 0
    fi
    warn "Устанавливаю пакеты для безопасного хранения токенов (gnome-keyring / libsecret)..."
    if command -v apt-get >/dev/null 2>&1; then
        sudo apt-get update -qq
        sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq gnome-keyring libsecret-1-0 2>/dev/null || true
        ok "Пакеты keyring установлены (apt)"
    elif command -v dnf >/dev/null 2>&1; then
        sudo dnf install -y -q gnome-keyring libsecret 2>/dev/null || true
        ok "Пакеты keyring установлены (dnf)"
    elif command -v pacman >/dev/null 2>&1; then
        sudo pacman -S --noconfirm --needed gnome-keyring libsecret 2>/dev/null || true
        ok "Пакеты keyring установлены (pacman)"
    elif command -v zypper >/dev/null 2>&1; then
        sudo zypper --non-interactive install -y gnome-keyring libsecret-1-0 2>/dev/null || true
        ok "Пакеты keyring установлены (zypper)"
    else
        warn "Не удалось определить пакетный менеджер. Поставь вручную: gnome-keyring libsecret"
        return 1
    fi
}

# Берём последний релиз со страницы /releases/latest и собираем URL AppImage
resolve_appimage_url() {
    DOWNLOAD_URL=""
    local html tag ver code final_url

    step "Читаю ${RELEASES_URL}"
    html=$(mktemp)

    # Следим за редиректом /latest → /tag/vX.Y.Z
    final_url=$(curl -sS -L -A "$CURL_UA" --connect-timeout 15 --max-time 45 \
        -o "$html" -w "%{url_effective}" \
        "$RELEASES_URL" 2>/dev/null || true)

    code=$(curl -sS -A "$CURL_UA" --connect-timeout 10 --max-time 15 \
        -o /dev/null -w "%{http_code}" -I "$RELEASES_URL" 2>/dev/null || echo "000")

    # 1) Тег из финального URL после редиректа
    tag=$(printf '%s' "$final_url" | grep -oE 'tag/[^/[:space:]?#]+' | head -n1 | cut -d/ -f2 || true)

    # 2) Тег из HTML
    if [[ -z "$tag" ]]; then
        tag=$(grep -oE "/${REPO}/releases/tag/[^\"' <>]+" "$html" 2>/dev/null \
            | head -n1 | sed 's|.*/tag/||' || true)
    fi

    rm -f "$html"

    if [[ -z "$tag" ]]; then
        fail "Не удалось определить версию релиза. Открой ${RELEASES_URL}"
    fi
    ok "Релиз: ${tag}"

    ver="${tag#v}"
    DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${tag}/ChaldLauncher-${ver}-linux-x86_64.AppImage"

    step "Проверяю AppImage..."
    code=$(curl -sS -A "$CURL_UA" --connect-timeout 10 --max-time 20 \
        -o /dev/null -w "%{http_code}" -I "$DOWNLOAD_URL" 2>/dev/null || echo "000")

    if [[ "$code" != "200" && "$code" != "302" && "$code" != "301" ]]; then
        fail "AppImage не найден (${code}): ${DOWNLOAD_URL}"
    fi
    ok "Найден: $(basename "$DOWNLOAD_URL")"
}

do_install() {
    printf '\n' >&2
    printf '%b\n' "${BOLD}Установка ${APP_NAME}${NC}" >&2
    printf '%s\n' "----------------------------------------" >&2

    need_cmd curl
    install_fuse2 || true
    install_keyring || true
    resolve_appimage_url

    step "Создаю директории"
    mkdir -p "$INSTALL_DIR" "$BIN_DIR" "$DESKTOP_DIR" "$ICON_DIR"
    ok "Директории готовы"

    step "Скачиваю $(basename "$DOWNLOAD_URL")"
    local tmp_file
    tmp_file=$(mktemp --suffix=.AppImage)

    # Узкий прогресс-бар (~32 символа)
    if ! COLUMNS=32 curl -fL --progress-bar \
            --connect-timeout 15 --max-time 600 \
            -A "$CURL_UA" \
            -o "$tmp_file" \
            "$DOWNLOAD_URL"; then
        rm -f "$tmp_file"
        fail "Ошибка при скачивании"
    fi

    if [[ ! -s "$tmp_file" ]]; then
        rm -f "$tmp_file"
        fail "Скачанный файл пустой"
    fi
    ok "Скачивание завершено"

    step "Устанавливаю AppImage"
    mv -f "$tmp_file" "$APPIMAGE_PATH"
    chmod +x "$APPIMAGE_PATH"
    ok "AppImage: $APPIMAGE_PATH"

    step "Создаю команду запуска"
    # Обёртка, чтобы всегда передавать --password-store (иначе сессия слетает после рестарта)
    cat > "$SYMLINK" << EOF
#!/usr/bin/env bash
exec "$APPIMAGE_PATH" --password-store=gnome-libsecret "\$@"
EOF
    chmod +x "$SYMLINK"
    ok "Команда: $SYMLINK"
    case ":$PATH:" in
        *":$BIN_DIR:"*) ;;
        *) warn "Добавь $BIN_DIR в PATH, чтобы работала команда chaldlauncher" ;;
    esac

    step "Иконка"
    local icon_ok=false
    if "$APPIMAGE_PATH" --appimage-extract >/dev/null 2>&1; then
        local found
        found=$(find squashfs-root -type f \( -name '*.png' -o -name '*.svg' \) 2>/dev/null \
            | grep -iE '(icon|logo|chald)' | head -n1 || true)
        if [[ -n "$found" ]]; then
            cp "$found" "${ICON_DIR}/${APP_NAME}.png" 2>/dev/null \
                || cp "$found" "${ICON_DIR}/${APP_NAME}.svg" 2>/dev/null || true
            icon_ok=true
        fi
        rm -rf squashfs-root
    fi
    if $icon_ok; then ok "Иконка извлечена"; else warn "Иконку извлечь не удалось"; fi

    step "Ярлык в меню приложений"
    # --password-store=gnome-libsecret заставляет Electron использовать нормальный keyring,
    # иначе после перезагрузки сессия Microsoft (лицензия) сбрасывается.
    cat > "$DESKTOP_FILE" << EOF
[Desktop Entry]
Type=Application
Name=ChaldLauncher
Comment=Minecraft Launcher by Chald Studio
Exec=${APPIMAGE_PATH} --password-store=gnome-libsecret
Icon=${APP_NAME}
Terminal=false
Categories=Game;
StartupWMClass=ChaldLauncher
Keywords=minecraft;launcher;mods;
EOF
    chmod +x "$DESKTOP_FILE"
    ok "Ярлык: $DESKTOP_FILE (с --password-store=gnome-libsecret)"
    command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
    command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -f -t "${HOME}/.local/share/icons/hicolor" 2>/dev/null || true

    printf '\n' >&2
    printf '%b\n' "${GREEN}${BOLD}Готово!${NC}" >&2
    printf '\n' >&2
    printf '%s\n' "  Запуск:" >&2
    printf '%s\n' "    • меню приложений — ChaldLauncher" >&2
    printf '%s\n' "    • терминал         — chaldlauncher" >&2
    printf '%s\n' "    • файл             — $APPIMAGE_PATH" >&2
    printf '\n' >&2
    printf '%s\n' "  Удаление: $0 --uninstall" >&2
    printf '\n' >&2
}

do_uninstall() {
    printf '\n' >&2
    printf '%b\n' "${BOLD}Удаление ${APP_NAME}${NC}" >&2
    printf '%s\n' "----------------------------------------" >&2
    step "Удаляю файлы"
    [[ -f "$APPIMAGE_PATH" ]] && rm -f "$APPIMAGE_PATH" && ok "AppImage удалён" || warn "AppImage не найден"
    [[ -L "$SYMLINK" ]] && rm -f "$SYMLINK" && ok "Симлинк удалён" || warn "Симлинк не найден"
    [[ -f "$DESKTOP_FILE" ]] && rm -f "$DESKTOP_FILE" && ok "Ярлык удалён" || warn "Ярлык не найден"
    rm -f "${ICON_DIR}/${APP_NAME}.png" "${ICON_DIR}/${APP_NAME}.svg" 2>/dev/null || true
    [[ -d "$INSTALL_DIR" && -z "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]] && rmdir "$INSTALL_DIR" 2>/dev/null || true
    command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
    printf '\n' >&2
    ok "ChaldLauncher удалён"
    printf '\n' >&2
}

case "${1:-}" in
    --uninstall|-u) do_uninstall ;;
    --help|-h)
        echo "Использование: $0 [--uninstall]"
        echo "  (без аргументов)  установить/обновить"
        echo "  --uninstall, -u   удалить"
        ;;
    *) do_install ;;
esac
