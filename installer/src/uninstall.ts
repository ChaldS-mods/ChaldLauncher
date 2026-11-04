/**
 * Сценарий удаления для «Приложения и возможности». Лежит рядом с лаунчером (uninstall.ps1), без дополнительных exe.
 * Запускается через powershell.exe, копирует сам себя в %TEMP% (иначе не сможет удалить собственную папку),
 * спрашивает подтверждение и отдельно спрашивает про данные пользователя (по умолчанию они остаются).
 */

export interface UninstallParams {
  productName: string;
  exe: string;
  /** имя ключа в HKCU\...\Uninstall */
  keyName: string;
}

/** Экранирование строки для одинарных кавычек PowerShell. */
export function psq(s: string): string {
  return s.replace(/'/g, "''");
}

export function buildUninstallScript(p: UninstallParams): string {
  const procName = p.exe.replace(/\.exe$/i, '');
  const body = `param(
  [string]$InstallDir = '',
  [switch]$Relocated
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$Product  = '${psq(p.productName)}'
$ProcName = '${psq(procName)}'
$RegKey   = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${psq(p.keyName)}'
$Title    = 'Удаление ' + $Product
$nl       = [Environment]::NewLine

function Show([string]$text, [string]$buttons = 'OK', [string]$icon = 'Information', [string]$default = 'Button1') {
  return [System.Windows.Forms.MessageBox]::Show($text, $Title, $buttons, $icon, $default)
}

if (-not $Relocated) {
  # Скрипт удаляет свою же папку, поэтому продолжаем с копии во временной папке.
  $here = Split-Path -Parent $MyInvocation.MyCommand.Path
  $tmp  = Join-Path $env:TEMP ('chald-uninstall-' + [guid]::NewGuid().ToString('N') + '.ps1')
  Copy-Item -LiteralPath $MyInvocation.MyCommand.Path -Destination $tmp
  Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $tmp + '"'),
    '-Relocated', '-InstallDir', ('"' + $here + '"')
  )
  exit 0
}

# Удаляем только папку, которую создал наш установщик.
if (-not $InstallDir -or -not (Test-Path -LiteralPath (Join-Path $InstallDir '.chald-install.json'))) {
  Show ('Не найдена установленная копия ' + $Product + '.') 'OK' 'Error' | Out-Null
  exit 1
}

$ask = Show ('Удалить ' + $Product + ' с этого компьютера?' + $nl + $nl + $InstallDir) 'YesNo' 'Question' 'Button1'
if ($ask -ne 'Yes') { exit 0 }

$data = Join-Path $env:APPDATA $Product
$wipeData = $false
if (Test-Path -LiteralPath $data) {
  $a = Show ('Удалить также ваши данные (инстансы, миры, настройки, аккаунты)?' + $nl + $nl + $data + $nl + $nl + 'Если нажать «Нет», данные останутся, и после повторной установки всё будет на месте.') 'YesNoCancel' 'Warning' 'Button2'
  if ($a -eq 'Cancel') { exit 0 }
  $wipeData = ($a -eq 'Yes')
}

try {
  Get-Process -Name $ProcName -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and $_.Path.StartsWith($InstallDir, [StringComparison]::OrdinalIgnoreCase) } |
    Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 700

  Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) ($Product + '.lnk')) -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('Programs')) $Product) -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $RegKey -Recurse -Force -ErrorAction SilentlyContinue
  if ($wipeData) { Remove-Item -LiteralPath $data -Recurse -Force }
  Remove-Item -LiteralPath $InstallDir -Recurse -Force
} catch {
  Show ('Не удалось удалить всё до конца:' + $nl + $_.Exception.Message + $nl + $nl + 'Закройте ' + $Product + ' и запустите удаление ещё раз.') 'OK' 'Error' | Out-Null
  exit 1
}

Show ($Product + ' удалён.') | Out-Null
Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
`;
  // Windows PowerShell 5 читает .ps1 без BOM как ANSI, поэтому кириллице нужен UTF-8 BOM; переводы строк CRLF.
  return '\ufeff' + body.replace(/\r?\n/g, '\r\n');
}
