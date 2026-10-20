// Упаковывает собранный лаунчер (electron-builder --dir) в payload/payload.chpk.
// Использование: node scripts/pack-payload.mjs [папка win-unpacked]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { packDir } = require('../dist/payload.js');

const launcher = JSON.parse(fs.readFileSync(path.join(root, '..', 'package.json'), 'utf8'));
const productName = launcher.build?.productName ?? launcher.productName;
const appId = launcher.build?.appId;
if (!productName || !appId) throw new Error('В package.json лаунчера нет build.productName/build.appId');

const src = path.resolve(process.argv[2] ?? path.join(root, '..', 'release', 'win-unpacked'));
if (!fs.existsSync(src)) throw new Error(`Нет папки ${src}. Сначала выполните в корне проекта: npm run dist:dir`);

const meta = { version: launcher.version, productName, exe: `${productName}.exe`, publisher: launcher.author ?? 'Chald Studio', appId };
const out = path.join(root, 'payload', 'payload.chpk');

console.log(`Упаковываю ${src}\n  -> ${out}`);
let lastLog = 0;
const header = await packDir(src, out, meta, (rel, i, n) => {
  if (Date.now() - lastLog > 700) {
    lastLog = Date.now();
    console.log(`  ${i + 1}/${n} ${rel}`);
  }
});
const mb = (b) => (b / 1024 / 1024).toFixed(1);
console.log(`Готово: ${header.files.length} файлов, ${mb(header.totalSize)} МБ -> ${mb(fs.statSync(out).size)} МБ, версия ${meta.version}`);
