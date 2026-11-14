import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/main/versions', () => ({
  loaderVersions: vi.fn(async (loader: string, mc: string) => (loader === 'neoforge' && mc === '1.21.1' ? [{ version: '21.1.200', stable: true }] : [])),
}));
vi.mock('../src/main/dns', async (orig) => ({ ...(await orig<typeof import('../src/main/dns')>()), dnsFetch: vi.fn() }));

import { dnsFetch } from '../src/main/dns';
import { runAiChat } from '../src/main/ai';

type Msg = { content?: string; tool_calls?: { id: string; function: { name: string; arguments: string } }[] };
const script: Msg[] = [];
const seenBodies: { messages: { role: string; content: string | null }[] }[] = [];

beforeEach(() => {
  script.length = 0;
  seenBodies.length = 0;
  vi.mocked(dnsFetch).mockImplementation(async (_u: unknown, init?: RequestInit) => {
    seenBodies.push(JSON.parse(String(init?.body)));
    const message = script.shift();
    if (!message) throw new Error('script exhausted');
    return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 });
  });
});

const call = (id: string, name: string, args: object): Msg => ({ content: '', tool_calls: [{ id, function: { name, arguments: JSON.stringify(args) } }] });

function fakeServices() {
  const installs = new Map<string, AbortController>();
  const inst = { id: 'pack', name: 'Pack', mcVersion: '1.21.1', loader: { type: 'neoforge', version: '21.1.200' }, state: 'not-installed', stateReason: 'Установка не завершена', settings: {}, modCount: 0, running: false };
  return {
    s: {
      appVersion: '1.0.0',
      ctx: () => ({ running: new Set(), installing: new Set(installs.keys()) }),
      installs,
      lastOp: () => ({ label: 'Скачиваю клиент', fraction: 0.4, status: 'running', message: null }),
      settings: { get: async () => ({ jvmArgs: '' }) },
      catalog: { getManifest: async () => ({ versions: [{ id: '1.21.1', type: 'release', releaseTime: '2024-08-08T00:00:00Z' }] }) },
      instances: {
        list: async () => [inst],
        get: async () => inst,
        create: async () => inst,
      },
      startInstall: (id: string) => { installs.set(id, new AbortController()); },
    } as never,
  };
}

const cfg = { provider: 'custom' as const, apiKey: '', model: 'm', baseUrl: 'http://127.0.0.1:1234/v1' };

describe('runAiChat honesty', () => {
  it('corrects a false «installed» claim and appends the real status', async () => {
    const { s } = fakeServices();
    script.push(
      call('c1', 'create_instance', { name: 'Pack', mcVersion: '1.21.1', loader: 'neoforge', install: true }),
      { content: 'Готово! Я всё установил, можно играть.' },
      { content: 'Профиль создан, игра ещё скачивается.' },
    );
    const res = await runAiChat(s, cfg, { messages: [{ role: 'user', content: 'сделай 1.21.1 neoforge' }] });
    const last = seenBodies[2]!.messages.at(-1)!;
    expect(last.role).toBe('user');
    expect(last.content).toContain('ещё устанавливается');
    expect(res.reply).toContain('игра ещё скачивается');
    expect(res.reply).toContain('⏳ **Pack** ещё устанавливается');
    expect(res.reply).toContain('40%');
  });

  it('refuses to let the model claim an action when no changing tool ran', async () => {
    const { s } = fakeServices();
    script.push({ content: 'Я установил Sodium.' }, { content: 'Пока ничего не устанавливал. Поставить Sodium?' });
    const res = await runAiChat(s, cfg, { messages: [{ role: 'user', content: 'поставь sodium' }] });
    expect(seenBodies[1]!.messages.at(-1)!.content).toContain('ничего не подтверждено');
    expect(res.reply).toContain('Пока ничего не устанавливал');
  });

  it('does not nudge a truthful answer', async () => {
    const { s } = fakeServices();
    script.push({ content: 'Привет! Чем помочь?' });
    const res = await runAiChat(s, cfg, { messages: [{ role: 'user', content: 'привет' }] });
    expect(seenBodies).toHaveLength(1);
    expect(res.reply).toBe('Привет! Чем помочь?');
  });
});

describe('runAiChat polls', () => {
  it('ends the turn with a poll and records the tool result for the history', async () => {
    const { s } = fakeServices();
    script.push({ content: 'Уточню:', tool_calls: [{ id: 'p1', function: { name: 'ask_user', arguments: JSON.stringify({ question: 'Какой загрузчик?', options: ['Fabric', 'NeoForge', 'Fabric', ''] }) } }] });
    const res = await runAiChat(s, cfg, { messages: [{ role: 'user', content: 'хочу моды' }] });
    expect(seenBodies).toHaveLength(1); // no further model call
    expect(res.poll).toMatchObject({ question: 'Какой загрузчик?', options: ['Fabric', 'NeoForge'], multiple: false });
    expect(res.reply).toBe('Уточню:');
    expect(res.steps[0]!.toolResults[0]!.name).toBe('ask_user');
  });

  it('rejects a poll with fewer than two options and lets the model fix it', async () => {
    const { s } = fakeServices();
    script.push(
      call('p1', 'ask_user', { question: 'Да?', options: ['Да'] }),
      call('p2', 'ask_user', { question: 'Продолжить?', options: ['Да', 'Нет'], multiple: true }),
    );
    const res = await runAiChat(s, cfg, { messages: [{ role: 'user', content: 'x' }] });
    expect(res.poll?.options).toEqual(['Да', 'Нет']);
    expect(res.poll?.multiple).toBe(true);
    expect(res.steps[0]!.toolResults[0]!.result).toContain('at least 2');
  });
});
