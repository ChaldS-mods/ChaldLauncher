import type { AiChatRequest, AiChatResponse, AiChatStep, AiPoll, AiProviderId, AiToolCall } from '../shared/ai';
import { AI_PROVIDERS } from '../shared/ai';
import { AppError } from './errors';
import { dnsFetch } from './dns';
import { AI_TOOL_DEFS, runAiTool, toolLabel } from './aiTools';
import type { Services } from './services';

export interface AiConfig {
  provider: AiProviderId;
  apiKey: string;
  model: string;
  baseUrl: string;
}

const MAX_ROUNDS = 14;
const MAX_HISTORY_MESSAGES = 30;
/** Tool results from earlier turns are shrunk: they only need to remind the model what happened (saves tokens on free tiers). */
const OLD_TOOL_RESULT_CHARS = 500;
/** Within one request, results older than the newest round are cut to this size. */
const ROUND_TOOL_RESULT_CHARS = 600;
const MAX_RATE_WAIT_MS = 45_000;

const SYSTEM_BASE = `Ты — Чалди, AI-агент лаунчера ChaldLauncher (Minecraft). Отвечай по-русски, кратко.
Действуй через инструменты, ничего не выдумывай: версии, id, файлы и описания бери только из результатов инструментов и блока «Контекст».
Правила:
1. Инстанс везде — параметр instance (id или имя).
2. Версии не угадывай: "latest", list_minecraft_versions, get_loader_versions. loaderVersion в create_instance оставляй пустым. Если пользователь не назвал версию или загрузчик — один короткий вопрос (по умолчанию предложи Fabric и последний релиз).
3. Новый инстанс: create_instance(install=true), затем get_instance_status(waitSeconds=30), пока не ready.
4. Мод: search_modrinth(instance) → get_mod_info (объясни, что это) → check_mod_compatibility → install_mod. Зависимости ставятся сами.
5. Описание: get_mod_info (Modrinth) или get_installed_mod_info (установленный); дальше читай с offset=nextOffset.
6. Краш: get_logs(errorsOnly=true), при нужде source=crash → причина по findings → конкретное действие (set_mod_enabled, обновить, зависимость, память).
7. update_mod без file, remove_mod и сборки — только по просьбе или после согласия.
8. Ошибка инструмента: прочитай hint, поправь аргументы, повтори раз. Не повторяй одинаковые вызовы.
9. Не ставь много модов сразу. Итог — коротко: что сделано и что дальше.
10. Правда о результате: «установлено/готово» говори только если инструмент это подтвердил (install_mod вернул ok; игра — get_instance_status state=ready). Скачивание игры идёт в фоне: пока не ready, пиши «устанавливается». Ошибку инструмента не скрывай.
11. Когда пользователю надо выбрать (версия, загрузчик, какой мод, подтверждение удаления/обновления) — вызови ask_user с вариантами и закончи ход. Не задавай такие вопросы текстом.
12. Форматируй ответ Markdown: короткие абзацы, списки, **жирный** для названий, \`код\` для файлов и версий.`;

async function buildSystem(s: Services): Promise<string> {
  const lines: string[] = [`Сегодня: ${new Date().toISOString().slice(0, 10)}. Лаунчер ${s.appVersion}.`];
  try {
    const manifest = await Promise.race([
      s.catalog.getManifest(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
    ]);
    const latest = manifest.versions.find((v) => v.type === 'release')?.id;
    if (latest) lines.push(`Последний релиз Minecraft: ${latest}.`);
  } catch { /* offline: the agent can still call list_minecraft_versions */ }
  try {
    const list = await s.instances.list(s.ctx());
    if (!list.length) lines.push('Инстансов пока нет.');
    else {
      lines.push('Инстансы:');
      for (const i of list.slice(0, 10)) {
        const ld = i.loader.type === 'vanilla' ? 'vanilla' : `${i.loader.type} ${i.loader.version ?? '?'}`;
        lines.push(`- id=${i.id} «${i.name}» — Minecraft ${i.mcVersion}, ${ld}, ${i.state}, модов: ${i.modCount}${i.running ? ', игра запущена' : ''}`);
      }
      if (list.length > 10) lines.push(`…и ещё ${list.length - 10} (list_instances).`);
    }
  } catch { /* the tools report problems themselves */ }
  return `${SYSTEM_BASE}\n\nКонтекст (на момент сообщения):\n${lines.join('\n')}`;
}

// ---------------------------------------------------------------- schema helpers

function safeJsonObj(raw: string | undefined): Record<string, unknown> {
  try {
    const j = JSON.parse(raw || '{}') as unknown;
    return j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Gemini rejects several JSON Schema keywords; only a subset is allowed. */
function stripSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSchema);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === 'additionalProperties' || k === '$schema' || k === 'exclusiveMinimum' || k === 'exclusiveMaximum') continue;
    if (k === 'required' && Array.isArray(v) && v.length === 0) continue;
    out[k] = k === 'type' && v === 'integer' ? 'number' : stripSchema(v);
  }
  return out;
}

function openaiTools() {
  return AI_TOOL_DEFS.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

function geminiTools() {
  return [{
    functionDeclarations: AI_TOOL_DEFS.map((t) => {
      const props = (t.parameters as { properties?: Record<string, unknown> }).properties;
      // Gemini refuses an OBJECT schema without properties: such tools are declared without parameters
      return props && Object.keys(props).length
        ? { name: t.name, description: t.description, parameters: stripSchema(t.parameters) }
        : { name: t.name, description: t.description };
    }),
  }];
}

// ---------------------------------------------------------------- network

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const u = new URL(url);
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  };

  const reason = (e: unknown): string => {
    const c = (e as { cause?: { code?: string; message?: string } } | null)?.cause;
    const code = c?.code ?? '';
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'DNS не нашёл хост (проверь интернет или DNS в Настройках → Сеть)';
    if (code === 'ETIMEDOUT' || code.includes('TIMEOUT')) return 'таймаут соединения';
    if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') return 'соединение разорвано';
    if (code === 'ECONNREFUSED') return 'сервер отклонил соединение';
    if (code.startsWith('CERT_') || code.includes('SSL') || code.includes('TLS')) return `ошибка TLS (${code})`;
    if (c?.message) return c.message;
    return e instanceof Error ? e.message : String(e);
  };

  let res: Response;
  try {
    res = await dnsFetch(u, init);
  } catch {
    // Custom DNS / undici failed — fall back to system fetch
    try {
      res = await fetch(u, init);
    } catch (e2) {
      throw new AppError(
        'AI_NET',
        `Нет связи с ${u.host}: ${reason(e2)}. Если включён свой DNS — попробуй «system» или проверь ключ/интернет.`,
      );
    }
  }

  const text = await res.text();
  let data: unknown = text;
  try { data = JSON.parse(text); } catch { /* keep text */ }
  if (!res.ok) {
    let msg = text.slice(0, 500);
    if (typeof data === 'object' && data) {
      const e = (data as { error?: unknown; message?: string }).error;
      if (typeof e === 'string') msg = e;
      else if (e && typeof e === 'object') {
        const o = e as { message?: string; status?: string; code?: number; failed_generation?: string };
        msg = o.message || o.status || JSON.stringify(e).slice(0, 400);
        if (o.failed_generation && !msg.includes('failed_generation')) msg += ' [tool_use_failed]';
      } else if (typeof (data as { message?: string }).message === 'string') {
        msg = (data as { message: string }).message;
      }
    }
    throw new AppError('AI_HTTP', `AI HTTP ${res.status}: ${msg}`);
  }
  return data;
}

const isRateLimit = (e: unknown): boolean => e instanceof AppError && e.code === 'AI_HTTP' && /AI HTTP (429|503|529)/.test(e.message);
const isBadToolCall = (e: unknown): boolean =>
  e instanceof AppError && e.code === 'AI_HTTP' && /tool_use_failed|failed_generation|Failed to call a function|malformed/i.test(e.message);

/** "Please try again in 16.785s" / "in 1m3.5s" -> milliseconds (null when the provider did not say). */
export function retryAfterMs(message: string): number | null {
  const m = /try again in\s+(?:(\d+)m)?\s*(\d+(?:\.\d+)?)s/i.exec(message);
  if (!m) return null;
  return Math.ceil((Number(m[1] ?? 0) * 60 + Number(m[2])) * 1000) + 500;
}

// ---------------------------------------------------------------- provider adapters

interface RoundResult {
  content: string;
  toolCalls: AiToolCall[];
  /** Gemini: full model parts (incl. thought_signature) — must be echoed back */
  geminiParts?: unknown[];
}

interface Adapter {
  /** Shrinks tool results of earlier rounds of this request (only the newest round stays complete). */
  compact(): void;
  call(withTools: boolean): Promise<RoundResult>;
  pushAssistant(r: RoundResult): void;
  pushToolResults(results: { tc: AiToolCall; result: string }[]): void;
  pushUser(text: string): void;
}

type HistoryMsg = AiChatRequest['messages'][number];

/** Keeps the tail of the conversation, starts it at a user message and shrinks old tool results. */
function prepareHistory(messages: HistoryMsg[]): HistoryMsg[] {
  let msgs = messages.filter((m) => m.role !== 'system');
  if (msgs.length > MAX_HISTORY_MESSAGES) {
    msgs = msgs.slice(-MAX_HISTORY_MESSAGES);
    const firstUser = msgs.findIndex((m) => m.role === 'user');
    msgs = firstUser > 0 ? msgs.slice(firstUser) : msgs;
  }
  let lastUser = -1;
  msgs.forEach((m, i) => { if (m.role === 'user') lastUser = i; });
  return msgs.map((m, i) =>
    m.role === 'tool' && i < lastUser && m.content.length > OLD_TOOL_RESULT_CHARS
      ? { ...m, content: `${m.content.slice(0, OLD_TOOL_RESULT_CHARS)}… [обрезано]` }
      : m);
}

function openAiAdapter(cfg: AiConfig, system: string, history: HistoryMsg[]): Adapter {
  const base = (cfg.baseUrl || AI_PROVIDERS.find((p) => p.id === cfg.provider)?.defaultBaseUrl || '').replace(/\/$/, '');
  const messages: { role: string; content: string | null; tool_calls?: unknown; tool_call_id?: string; name?: string }[] = [
    { role: 'system', content: system },
  ];
  for (const m of history) {
    if (m.role === 'tool') {
      messages.push({ role: 'tool', content: m.content, tool_call_id: m.toolCallId, name: m.toolName });
    } else if (m.role === 'assistant' && m.toolCalls?.length) {
      messages.push({
        role: 'assistant', content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments } })),
      });
    } else {
      messages.push({ role: m.role, content: m.content });
    }
  }
  return {
    compact() {
      const lastAssistant = messages.map((m) => m.role === 'assistant' && m.tool_calls ? 1 : 0).lastIndexOf(1);
      messages.forEach((m, i) => {
        if (m.role === 'tool' && i < lastAssistant && (m.content?.length ?? 0) > ROUND_TOOL_RESULT_CHARS) {
          m.content = `${m.content!.slice(0, ROUND_TOOL_RESULT_CHARS)}… [обрезано]`;
        }
      });
    },
    async call(withTools) {
      if (!base) throw new AppError('AI_CONFIG', 'Base URL is empty');
      if (!cfg.apiKey && cfg.provider !== 'custom') throw new AppError('AI_CONFIG', 'API key is empty — set it in Settings → AI');
      const data = await postJson(`${base}/chat/completions`, { Authorization: `Bearer ${cfg.apiKey}` }, {
        model: cfg.model,
        messages,
        ...(withTools ? { tools: openaiTools(), tool_choice: 'auto' } : {}),
        temperature: 0.2,
      }) as { choices?: { message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[] };
      const msg = data.choices?.[0]?.message;
      if (!msg) throw new AppError('AI_HTTP', 'Empty AI response');
      const toolCalls: AiToolCall[] = withTools
        ? (msg.tool_calls ?? []).map((tc, i) => ({ id: tc.id || `call_${Date.now()}_${i}`, name: tc.function.name, arguments: tc.function.arguments || '{}' }))
        : [];
      return { content: msg.content ?? '', toolCalls };
    },
    pushAssistant(r) {
      messages.push({
        role: 'assistant', content: r.content || null,
        ...(r.toolCalls.length ? { tool_calls: r.toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments } })) } : {}),
      });
    },
    pushToolResults(results) {
      for (const { tc, result } of results) messages.push({ role: 'tool', content: result, tool_call_id: tc.id, name: tc.name });
    },
    pushUser(text) {
      messages.push({ role: 'user', content: text });
    },
  };
}

/** Function responses must be a JSON object (Struct) for Gemini. */
function geminiResponseObject(content: string): Record<string, unknown> {
  try {
    const j = JSON.parse(content) as unknown;
    if (j && typeof j === 'object' && !Array.isArray(j)) return j as Record<string, unknown>;
    return { result: j };
  } catch {
    return { result: content };
  }
}

const SKIP_SIGNATURE = 'skip_thought_signature_validator';

function geminiAdapter(cfg: AiConfig, system: string, history: HistoryMsg[]): Adapter {
  type Content = { role: string; parts: unknown[] };
  const contents: Content[] = [];
  let pending: unknown[] = [];
  const flush = () => {
    if (pending.length) contents.push({ role: 'user', parts: pending });
    pending = [];
  };
  // A model turn with functionCall must be followed by ONE user turn with all its functionResponses.
  for (const m of history) {
    if (m.role === 'tool') {
      pending.push({ functionResponse: { name: m.toolName || 'tool', response: geminiResponseObject(m.content) } });
      continue;
    }
    if (m.role === 'user' && pending.length) {
      pending.push({ text: m.content || '…' });
      flush();
      continue;
    }
    flush();
    if (m.role === 'assistant' && m.toolCalls?.length) {
      contents.push({
        role: 'model',
        parts: [
          ...(m.content ? [{ text: m.content }] : []),
          ...m.toolCalls.map((tc) => ({ functionCall: { name: tc.name, args: safeJsonObj(tc.arguments) }, thoughtSignature: SKIP_SIGNATURE })),
        ],
      });
    } else {
      contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content || '…' }] });
    }
  }
  flush();

  return {
    compact() {
      const lastModel = contents.map((c) => c.role).lastIndexOf('model');
      contents.forEach((c, i) => {
        if (c.role !== 'user' || i >= lastModel) return;
        for (const part of c.parts as { functionResponse?: { response: Record<string, unknown> } }[]) {
          const fr = part.functionResponse;
          if (!fr) continue;
          const text = JSON.stringify(fr.response);
          if (text.length > ROUND_TOOL_RESULT_CHARS) fr.response = { result: `${text.slice(0, ROUND_TOOL_RESULT_CHARS)}… [обрезано]` };
        }
      });
    },
    async call(withTools) {
      if (!cfg.apiKey) throw new AppError('AI_CONFIG', 'Gemini API key is empty — set it in Settings → AI');
      const model = cfg.model || 'gemini-2.0-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`;
      const data = await postJson(url, {}, {
        system_instruction: { parts: [{ text: system }] },
        contents,
        ...(withTools ? { tools: geminiTools() } : {}),
        generationConfig: { temperature: 0.2 },
      }) as { candidates?: { content?: { parts?: Record<string, unknown>[] } }[] };
      // Keep parts EXACTLY as returned (thoughtSignature required on echo)
      const parts = data.candidates?.[0]?.content?.parts ?? [];
      let content = '';
      const toolCalls: AiToolCall[] = [];
      for (const p of parts) {
        if (typeof p.text === 'string' && !p.thought) content += p.text;
        const fc = (p.functionCall ?? p.function_call) as { name?: string; args?: Record<string, unknown>; arguments?: Record<string, unknown> } | undefined;
        if (withTools && fc?.name) {
          toolCalls.push({ id: `gem_${Date.now()}_${toolCalls.length}_${fc.name}`, name: fc.name, arguments: JSON.stringify(fc.args ?? fc.arguments ?? {}) });
        }
      }
      return { content, toolCalls, geminiParts: parts };
    },
    pushAssistant(r) {
      contents.push({
        role: 'model',
        parts: r.geminiParts?.length
          ? r.geminiParts
          : r.toolCalls.length
            ? r.toolCalls.map((tc) => ({ functionCall: { name: tc.name, args: safeJsonObj(tc.arguments) }, thoughtSignature: SKIP_SIGNATURE }))
            : [{ text: r.content || '…' }],
      });
    },
    pushToolResults(results) {
      contents.push({
        role: 'user',
        parts: results.map(({ tc, result }) => ({ functionResponse: { name: tc.name, response: geminiResponseObject(result) } })),
      });
    },
    pushUser(text) {
      contents.push({ role: 'user', parts: [{ text }] });
    },
  };
}

// ---------------------------------------------------------------- agent loop

export type AiProgressFn = (e: import('../shared/ai').AiProgressEvent) => void;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One model call with retries for rate limits (waits as long as the provider asks) and for a malformed tool call. */
async function callWithRetry(adapter: Adapter, withTools: boolean, onProgress?: AiProgressFn): Promise<RoundResult> {
  let rate = 0;
  let format = 0;
  for (;;) {
    try {
      return await adapter.call(withTools);
    } catch (e) {
      if (isRateLimit(e)) {
        const msg = (e as Error).message;
        const wait = retryAfterMs(msg) ?? 4000 * 2 ** rate;
        if (rate < 3 && wait <= MAX_RATE_WAIT_MS) {
          onProgress?.({ kind: 'thinking', label: `Лимит провайдера, жду ${Math.ceil(wait / 1000)} с…` });
          await sleep(wait);
          rate++;
          continue;
        }
        throw new AppError('AI_RATE', `Провайдер ограничил число токенов в минуту${wait > MAX_RATE_WAIT_MS ? ` (нужно ждать ~${Math.ceil(wait / 1000)} с)` : ''}. Повтори через минуту или выбери другую модель/провайдера в Настройках → AI.`);
      }
      if (withTools && isBadToolCall(e) && format < 2) {
        adapter.pushUser('Предыдущий вызов инструмента был в неверном формате. Повтори его, строго следуя JSON-схеме инструмента (только объявленные параметры).');
        format++;
        continue;
      }
      throw e;
    }
  }
}

/** Tools that change something: a success claim in the answer is only true if one of them succeeded in this request. */
const MUTATING = new Set([
  'create_instance', 'install_instance', 'install_mod', 'install_modpack', 'remove_mod', 'set_mod_enabled', 'update_mod', 'apply_jvm_preset',
]);
/** First-person claims of a finished action («установил», «создал», «готово»…). */
const CLAIM_RE = /(?<!\p{L})(?:(?:установил|поставил|создал|скачал|удалил|обновил|отключил|включил|добавил|применил)[аио]?|(?:установлен|создан)[аоы]?|готово)(?!\p{L})/iu;

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const j = JSON.parse(text) as unknown;
    return j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function parsePoll(argsJson: string): AiPoll | string {
  const a = safeJsonObj(argsJson);
  const question = typeof a.question === 'string' ? a.question.trim() : '';
  const raw = Array.isArray(a.options) ? a.options : [];
  const options = [...new Set(raw.map((o) => (typeof o === 'string' ? o.trim() : '')).filter(Boolean))].slice(0, 8);
  if (!question) return 'Argument "question" is required.';
  if (options.length < 2) return 'Argument "options" must contain at least 2 different non-empty strings.';
  return { id: Math.random().toString(36).slice(2, 10), question, options, multiple: a.multiple === true || a.multiple === 'true' };
}

interface InstallIssue { id: string; name: string; kind: 'installing' | 'failed' | 'missing'; detail: string }

/** What is really going on with the installs this request started (ground truth, not what the model said). */
async function installIssues(s: Services, ids: Iterable<string>): Promise<InstallIssue[]> {
  const out: InstallIssue[] = [];
  for (const id of ids) {
    try {
      const inst = await s.instances.get(id, s.ctx());
      if (s.installs.has(id)) {
        const op = s.lastOp(id);
        out.push({ id, name: inst.name, kind: 'installing', detail: op ? `${op.label}${op.fraction === null ? '' : `, ${Math.round(op.fraction * 100)}%`}` : 'идёт загрузка' });
      } else if (inst.state !== 'ready') {
        const op = s.lastOp(id);
        out.push(op?.status === 'error'
          ? { id, name: inst.name, kind: 'failed', detail: op.message ?? op.label }
          : { id, name: inst.name, kind: 'missing', detail: inst.stateReason ?? 'игра не установлена' });
      }
    } catch { /* the instance may have been removed meanwhile */ }
  }
  return out;
}

function issuesText(issues: InstallIssue[]): string {
  return issues.map((i) => i.kind === 'installing'
    ? `- ⏳ **${i.name}** ещё устанавливается (${i.detail}). Игра пока не готова.`
    : i.kind === 'failed'
      ? `- ❌ **${i.name}**: установка не удалась — ${i.detail}`
      : `- ⚠️ **${i.name}**: игра не установлена (${i.detail}).`).join('\n');
}

export async function runAiChat(s: Services, cfg: AiConfig, req: AiChatRequest, onProgress?: AiProgressFn): Promise<AiChatResponse> {
  if (!cfg.model) {
    const info = AI_PROVIDERS.find((p) => p.id === cfg.provider);
    cfg = { ...cfg, model: info?.defaultModel ?? 'gpt-4o-mini' };
  }

  const system = await buildSystem(s);
  const history = prepareHistory(req.messages);
  const adapter = cfg.provider === 'gemini' ? geminiAdapter(cfg, system, history) : openAiAdapter(cfg, system, history);

  const steps: AiChatStep[] = [];
  const seen = new Map<string, number>();
  const startedInstalls = new Set<string>();
  let didMutate = false;
  let nudgedEmpty = false;
  let nudgedClaim = false;
  let poll: AiPoll | undefined;

  for (let round = 0; round < MAX_ROUNDS && !poll; round++) {
    // On the last round tools are switched off so the model has to answer instead of ending silently.
    const withTools = round < MAX_ROUNDS - 1;
    onProgress?.({ kind: 'thinking', label: 'Чалди думает…' });
    adapter.compact();
    const r = await callWithRetry(adapter, withTools, onProgress);

    if (!r.toolCalls.length) {
      if (!r.content.trim() && steps.length && !nudgedEmpty) {
        // the model finished with tools but wrote nothing: ask for the summary once
        nudgedEmpty = true;
        adapter.pushUser('Коротко подведи итог для пользователя: что сделано и что дальше.');
        continue;
      }
      // Do not let «установил» through when reality says otherwise.
      if (!nudgedClaim && withTools && CLAIM_RE.test(r.content)) {
        const issues = await installIssues(s, startedInstalls);
        let correction = '';
        if (issues.length) correction = `Системная проверка: ${issues.map((i) => i.kind === 'installing' ? `«${i.name}» ещё устанавливается (${i.detail})` : i.kind === 'failed' ? `установка «${i.name}» завершилась ошибкой: ${i.detail}` : `в «${i.name}» игра не установлена`).join('; ')}. Исправь ответ: не утверждай, что всё установлено.`;
        else if (!didMutate && !startedInstalls.size) correction = 'Системная проверка: в этом запросе ты не вызывал ни одного инструмента, который что-то меняет, и ничего не подтверждено. Не утверждай, что действие выполнено: либо вызови нужный инструмент, либо скажи, что ещё не сделано.';
        if (correction) {
          nudgedClaim = true;
          adapter.pushAssistant(r);
          adapter.pushUser(correction);
          continue;
        }
      }
      const issues = await installIssues(s, startedInstalls);
      const content = issues.length ? `${r.content.trim()}\n\n${issuesText(issues)}`.trim() : r.content;
      onProgress?.({ kind: 'text', label: 'Чалди', detail: content });
      steps.push({ content, toolCalls: [], toolResults: [], finalContent: content });
      break;
    }

    adapter.pushAssistant(r);
    if (r.content.trim()) onProgress?.({ kind: 'text', label: 'Чалди', detail: r.content });
    const toolResults: AiChatStep['toolResults'] = [];
    const forModel: { tc: AiToolCall; result: string }[] = [];
    for (const tc of r.toolCalls) {
      onProgress?.({ kind: 'tool_start', label: toolLabel(tc.name), toolName: tc.name, toolCallId: tc.id, detail: tc.arguments });
      let result: string;
      if (tc.name === 'ask_user') {
        const parsed: AiPoll | string = poll ? 'Only one poll per turn.' : parsePoll(tc.arguments);
        if (typeof parsed === 'string') result = JSON.stringify({ error: parsed });
        else {
          poll = parsed;
          result = JSON.stringify({ status: 'waiting_for_user', note: 'Опрос показан пользователю. Закончи ход; ответ придёт следующим сообщением.' });
        }
      } else {
        // the same call twice in one request is a loop (and a double install): refuse it, except polling the status
        const sig = `${tc.name}:${tc.arguments}`;
        const count = (seen.get(sig) ?? 0) + 1;
        seen.set(sig, count);
        result = count > 1 && tc.name !== 'get_instance_status'
          ? JSON.stringify({ error: 'Этот вызов с теми же аргументами уже выполнялся в этом запросе.', hint: 'Используй предыдущий результат или измени аргументы. Если решения нет — объясни пользователю.' })
          : await runAiTool(s, tc.name, tc.arguments);
        const j = parseJson(result);
        if (j && !j.error) {
          if (MUTATING.has(tc.name)) didMutate = true;
          if ((tc.name === 'create_instance' || tc.name === 'install_instance') && j.installStarted === true && typeof j.id === 'string') startedInstalls.add(j.id);
        }
      }
      toolResults.push({ toolCallId: tc.id, name: tc.name, result });
      forModel.push({ tc, result });
      onProgress?.({ kind: 'tool_result', label: toolLabel(tc.name), toolName: tc.name, toolCallId: tc.id, detail: result });
    }
    adapter.pushToolResults(forModel);
    steps.push({ content: r.content, toolCalls: r.toolCalls, toolResults });
  }

  const texts = steps.map((st) => st.finalContent ?? st.content).filter((t) => t && t.trim());
  let reply = texts.join('\n\n').trim();
  if (!reply && !poll) {
    const last = steps[steps.length - 1];
    reply = (last?.toolResults ?? []).map((t) => {
      try {
        const j = JSON.parse(t.result) as { error?: string; message?: string };
        if (j.error) return `${toolLabel(t.name)}: ошибка — ${j.error}`;
        return `${toolLabel(t.name)}: ${j.message ?? 'готово'}`;
      } catch {
        return `${toolLabel(t.name)}: готово`;
      }
    }).join('\n');
  }
  return { steps, reply: reply || (poll ? '' : '…'), ...(poll ? { poll } : {}) };
}

export function aiConfigFromSettings(s: {
  aiProvider?: string;
  aiApiKey?: string;
  aiModel?: string;
  aiBaseUrl?: string;
}): AiConfig {
  const provider = (s.aiProvider as AiProviderId) || 'groq';
  const info = AI_PROVIDERS.find((p) => p.id === provider);
  return {
    provider,
    apiKey: s.aiApiKey ?? '',
    model: (s.aiModel && s.aiModel.trim()) || info?.defaultModel || '',
    baseUrl: (s.aiBaseUrl && s.aiBaseUrl.trim()) || info?.defaultBaseUrl || '',
  };
}
