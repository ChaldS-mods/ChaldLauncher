// Копирует интерфейс установщика в dist/ui и берёт шрифт ChaldPixel прямо из лаунчера (чтобы не хранить две копии).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist', 'ui');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });

for (const f of ['index.html', 'style.css', 'app.js']) fs.copyFileSync(path.join(root, 'src', 'ui', f), path.join(out, f));

const font = path.join(root, '..', 'src', 'renderer', 'fonts', 'ChaldPixel.woff');
if (!fs.existsSync(font)) throw new Error(`Не найден шрифт: ${font}`);
fs.copyFileSync(font, path.join(out, 'fonts', 'ChaldPixel.woff'));
console.log('UI скопирован в', out);
