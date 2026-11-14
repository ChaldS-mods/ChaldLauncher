'use strict';
(() => {
  const api = window.setup;
  const $ = (id) => document.getElementById(id);
  const PAGES = ['Loading', 'Welcome', 'Progress', 'Done', 'Error'];
  const TITLES = { Loading: 'Установка', Welcome: 'Установка', Progress: 'Идёт установка…', Done: 'Установка завершена', Error: 'Ошибка' };

  const state = { info: null, dir: '', dirOk: false, updating: false };

  function show(name) {
    for (const p of PAGES) $('page' + p).hidden = p !== name;
    $('winTitle').textContent = (state.info ? state.info.productName + ': ' : '') + TITLES[name].toLowerCase();
  }

  function fmtBytes(n) {
    const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i++;
    }
    return (i >= 3 ? n.toFixed(1).replace('.', ',') : Math.round(n)) + '\u00a0' + units[i];
  }

  function setHint(text, kind) {
    const el = $('space');
    el.textContent = text || '\u00a0';
    el.className = 'hint' + (kind ? ' hint--' + kind : '');
  }

  async function checkDir() {
    state.dirOk = false;
    $('btnInstall').disabled = true;
    const r = await api.checkDir(state.dir);
    if (r.error) {
      setHint(r.error, 'bad');
      return;
    }
    const nested = r.dir !== state.dir;
    state.dir = r.dir;
    $('dir').value = r.dir;
    $('dir').title = r.dir;
    const space = r.free === null ? 'Нужно около ' + fmtBytes(r.need) : 'Нужно около ' + fmtBytes(r.need) + ', свободно ' + fmtBytes(r.free);
    if (!r.enough) setHint(space + '. Места не хватает.', 'bad');
    else if (nested) setHint('Папка не пуста, поэтому установка пойдёт во вложенную папку. ' + space, 'note');
    else setHint(space, '');
    state.dirOk = r.enough;
    $('btnInstall').disabled = !r.enough;
  }

  async function init() {
    const info = await api.info();
    if (info.error) {
      $('errorText').textContent = info.error;
      $('btnRetry').hidden = true;
      show('Error');
      return;
    }
    state.info = info;
    state.updating = !!info.existing;
    state.dir = info.defaultDir;
    $('productName').textContent = info.productName;
    $('version').textContent = 'Версия ' + info.version;
    $('optDesktop').checked = info.cli.desktop;
    $('optMenu').checked = info.cli.startMenu;
    if (state.updating) {
      $('welcomeTitle').textContent = 'Обновление';
      $('welcomeLead').textContent = 'Найдена версия ' + info.existing.version + '. Она будет заменена версией ' + info.version + '. Ваши инстансы и настройки останутся на месте, запущенный лаунчер закроется.';
      $('btnInstall').textContent = 'Обновить';
    } else {
      $('welcomeTitle').textContent = 'Установка';
      $('welcomeLead').textContent = info.productName + ' будет установлен на этот компьютер. Права администратора не нужны.';
      $('btnInstall').textContent = 'Установить';
    }
    show('Welcome');
    await checkDir();
  }

  const PHASES = { prepare: 'Подготовка…', extract: 'Копирование файлов…', finish: 'Завершение…' };
  let unsubscribe = null;

  function setProgress(p) {
    const pct = Math.max(0, Math.min(100, Math.round(p.percent)));
    $('barFill').style.width = pct + '%';
    $('bar').setAttribute('aria-valuenow', String(pct));
    $('progressPct').textContent = pct + '%';
    $('progressPhase').textContent = PHASES[p.phase] || '';
    $('progressFile').textContent = p.file || '\u00a0';
  }

  async function startInstall() {
    if (!state.dirOk) return;
    $('progressTitle').textContent = state.updating ? 'Обновление…' : 'Установка…';
    $('btnAbort').disabled = false;
    $('btnAbort').textContent = 'Отмена';
    setProgress({ phase: 'prepare', percent: 0 });
    show('Progress');
    unsubscribe = api.onProgress(setProgress);
    const r = await api.install({ dir: state.dir, desktopShortcut: $('optDesktop').checked, startMenuShortcut: $('optMenu').checked });
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    if (r.ok) {
      $('doneTitle').textContent = state.updating ? 'Обновлено' : 'Готово';
      $('doneText').textContent = state.info.productName + ' ' + state.info.version + ' установлен в папку ' + r.dir;
      const ul = $('warnings');
      ul.textContent = '';
      for (const w of r.warnings || []) {
        const li = document.createElement('li');
        li.textContent = w;
        ul.appendChild(li);
      }
      ul.hidden = !(r.warnings && r.warnings.length);
      show('Done');
      updateFinish();
    } else if (r.cancelled) {
      show('Welcome');
      await checkDir();
    } else {
      $('errorText').textContent = r.error || 'Неизвестная ошибка';
      $('btnRetry').hidden = false;
      show('Error');
    }
  }

  function updateFinish() {
    $('btnFinish').textContent = $('optLaunch').checked ? 'Запустить' : 'Закрыть';
  }

  $('btnMin').addEventListener('click', () => api.minimize());
  $('btnClose').addEventListener('click', () => api.close());
  $('btnCancel').addEventListener('click', () => api.close());
  $('btnErrClose').addEventListener('click', () => api.close());
  $('btnRetry').addEventListener('click', async () => {
    show('Welcome');
    await checkDir();
  });
  $('btnBrowse').addEventListener('click', async () => {
    const picked = await api.chooseDir(state.dir);
    if (picked) {
      state.dir = picked;
      await checkDir();
    }
  });
  $('btnInstall').addEventListener('click', () => void startInstall());
  $('btnAbort').addEventListener('click', () => {
    $('btnAbort').disabled = true;
    $('btnAbort').textContent = 'Отменяю…';
    void api.cancel();
  });
  $('optLaunch').addEventListener('change', updateFinish);
  $('btnFinish').addEventListener('click', () => {
    if ($('optLaunch').checked) void api.launch();
    else void api.close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('pageWelcome').hidden) api.close();
  });

  void init();
})();
