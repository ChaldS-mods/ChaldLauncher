import { useEffect, useRef, useState } from 'react';
import type { AiMessage, AiPoll, AiProgressEvent } from '../../shared/ai';
import { call, errMsg, on } from '../api';
import { Icon } from '../components/Icon';
import { Markdown } from '../components/Markdown';
import { Empty } from '../components/ui';
import { useI18n } from '../i18n';
import { useStore } from '../store';

function rid(): string {
  return Math.random().toString(36).slice(2, 10);
}

type Bubble =
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'assistant'; text: string }
  | { id: string; kind: 'thinking'; text: string }
  | { id: string; kind: 'poll'; poll: AiPoll; selected: string[]; /** null = still open; [] = skipped */ answered: string[] | null }
  | {
      id: string;
      kind: 'tool';
      label: string;
      toolName: string;
      status: 'running' | 'done';
      detail?: string;
      open?: boolean;
    };

export function AiChatPage() {
  const { t } = useI18n();
  const toast = useStore((s) => s.toast);
  const go = useStore((s) => s.go);
  const settings = useStore((s) => s.settings);
  const [history, setHistory] = useState<AiMessage[]>([]);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const hasKey = !!(settings?.aiApiKey && settings.aiApiKey.trim());

  useEffect(() => {
    const el = bottomRef.current?.parentElement;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [bubbles, busy]);

  useEffect(() => {
    return on('ai:progress', (ev: AiProgressEvent) => {
      setBubbles((prev) => {
        if (ev.kind === 'thinking') {
          // replace last thinking or append
          const without = prev.filter((b) => b.kind !== 'thinking');
          return [...without, { id: rid(), kind: 'thinking', text: ev.label || 'Чалди думает…' }];
        }
        if (ev.kind === 'tool_start') {
          const without = prev.filter((b) => b.kind !== 'thinking');
          return [
            ...without,
            {
              id: ev.toolCallId || rid(),
              kind: 'tool',
              label: ev.label,
              toolName: ev.toolName || '',
              status: 'running',
              detail: ev.detail,
              open: false,
            },
          ];
        }
        if (ev.kind === 'tool_result') {
          return prev.map((b) =>
            b.kind === 'tool' && (b.id === ev.toolCallId || b.toolName === ev.toolName) && b.status === 'running'
              ? { ...b, status: 'done' as const, detail: ev.detail ?? b.detail }
              : b,
          );
        }
        if (ev.kind === 'text' && ev.detail) {
          const without = prev.filter((b) => b.kind !== 'thinking');
          return [...without, { id: rid(), kind: 'assistant', text: ev.detail }];
        }
        return prev;
      });
    });
  }, []);

  const answerPoll = (id: string, chosen: string[]) => {
    if (busy || !chosen.length) return;
    setBubbles((prev) => prev.map((b) => (b.kind === 'poll' && b.id === id ? { ...b, answered: chosen } : b)));
    void send(chosen.join(', '));
  };

  const togglePollOption = (id: string, option: string) => {
    setBubbles((prev) => prev.map((b) => {
      if (b.kind !== 'poll' || b.id !== id || b.answered) return b;
      const has = b.selected.includes(option);
      return { ...b, selected: has ? b.selected.filter((o) => o !== option) : [...b.selected, option] };
    }));
  };

  const toggleTool = (id: string) => {
    setBubbles((prev) =>
      prev.map((b) => (b.kind === 'tool' && b.id === id ? { ...b, open: !b.open } : b)),
    );
  };

  const send = async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || busy) return;
    if (!hasKey) {
      toast('error', t('ai.needKey'));
      go('settings');
      return;
    }
    const userMsg: AiMessage = { id: rid(), role: 'user', content: text, at: Date.now() };
    const nextHist = [...history, userMsg];
    setHistory(nextHist);
    // a typed message closes polls that were not answered with a click
    setBubbles((b) => [
      ...b.map((x) => (x.kind === 'poll' && x.answered === null ? { ...x, answered: [] } : x)),
      { id: userMsg.id, kind: 'user', text },
    ]);
    setInput('');
    setBusy(true);
    try {
      const payload = nextHist
        .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'tool')
        .map((m) => ({
          role: m.role,
          content: m.content,
          toolCalls: m.toolCalls,
          toolCallId: m.toolCallId,
          toolName: m.toolName,
        }));
      const res = await call('ai:chat', { messages: payload });

      // Append structured history for next turns
      const extra: AiMessage[] = [];
      for (const step of res.steps) {
        if (step.toolCalls.length) {
          extra.push({
            id: rid(),
            role: 'assistant',
            content: step.content || '',
            toolCalls: step.toolCalls,
            at: Date.now(),
          });
          for (const tr of step.toolResults) {
            extra.push({
              id: rid(),
              role: 'tool',
              content: tr.result,
              toolCallId: tr.toolCallId,
              toolName: tr.name,
              at: Date.now(),
            });
          }
        }
        if (step.finalContent) {
          extra.push({ id: rid(), role: 'assistant', content: step.finalContent, at: Date.now() });
        } else if (step.content && !step.toolCalls.length) {
          extra.push({ id: rid(), role: 'assistant', content: step.content, at: Date.now() });
        }
      }
      setHistory((h) => [...h, ...extra]);
      if (res.poll) {
        const poll = res.poll;
        setBubbles((prev) => [...prev.filter((b) => b.kind !== 'thinking'), { id: poll.id, kind: 'poll', poll, selected: [], answered: null }]);
      }

      // If progress events didn't deliver final text, show reply
      setBubbles((prev) => {
        const hasAssistant = prev.some((b) => b.kind === 'assistant' && b.text === res.reply);
        const withoutThinking = prev.filter((b) => b.kind !== 'thinking');
        if (res.reply && !hasAssistant) {
          // avoid duplicate if text event already added same content
          const last = withoutThinking[withoutThinking.length - 1];
          if (last?.kind === 'assistant' && last.text.trim() === res.reply.trim()) return withoutThinking;
          if (withoutThinking.some((b) => b.kind === 'assistant' && b.text.trim() === res.reply.trim())) {
            return withoutThinking;
          }
          // only add if no assistant after last user
          const lastUserIdx = [...withoutThinking].map((b, i) => ({ b, i })).filter((x) => x.b.kind === 'user').pop()?.i ?? -1;
          const after = withoutThinking.slice(lastUserIdx + 1);
          if (!after.some((b) => b.kind === 'assistant')) {
            return [...withoutThinking, { id: rid(), kind: 'assistant', text: res.reply }];
          }
        }
        return withoutThinking;
      });
    } catch (e) {
      const msg = errMsg(e);
      toast('error', msg);
      setBubbles((b) => [
        ...b.filter((x) => x.kind !== 'thinking'),
        { id: rid(), kind: 'assistant', text: `⚠ ${msg}` },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page page--ai">
      <header className="page-head page-head--ai">
        <div className="page-head__title">
          <Icon name="terminal" size={36} />
          <div>
            <h1>Чалди</h1>
            <p>{t('ai.subtitle')}</p>
          </div>
        </div>
        <div className="page-head__actions">
          <button
            type="button"
            className="btn"
            onClick={() => {
              setBubbles([]);
              setHistory([]);
            }}
            disabled={busy || !bubbles.length}
          >
            {t('ai.clear')}
          </button>
          <button type="button" className="btn" onClick={() => go('settings')}>
            {t('ai.settings')}
          </button>
        </div>
      </header>

      {!hasKey && (
        <div className="notice" role="note">
          <Icon name="gear" size={18} />
          <span className="grow">{t('ai.needKey')}</span>
          <button type="button" className="btn btn--sm" onClick={() => go('settings')}>{t('nav.settings')}</button>
        </div>
      )}

      <div className="ai-chat__body">
        {bubbles.length === 0 ? (
          <div className="ai-chat__empty">
            <Empty icon="terminal" title="Чалди на связи" text={t('ai.emptyHint')} />
          </div>
        ) : (
          <ul className="ai-chat__list">
            {bubbles.map((b) => {
              if (b.kind === 'user') {
                return (
                  <li key={b.id} className="ai-bubble ai-bubble--user">
                    <div className="ai-bubble__text">{b.text}</div>
                  </li>
                );
              }
              if (b.kind === 'assistant') {
                return (
                  <li key={b.id} className="ai-bubble ai-bubble--assistant ai-bubble--md">
                    <div className="ai-bubble__who">Чалди</div>
                    <Markdown text={b.text} />
                  </li>
                );
              }
              if (b.kind === 'poll') {
                const done = b.answered !== null;
                return (
                  <li key={b.id} className="ai-bubble ai-bubble--poll">
                    <div className="ai-bubble__who">Чалди спрашивает</div>
                    <div className="ai-poll__q">{b.poll.question}</div>
                    <div className="ai-poll__opts" role={b.poll.multiple ? 'group' : 'radiogroup'}>
                      {(Array.isArray(b.poll.options) ? b.poll.options : []).map((o) => {
                        const picked = done ? b.answered!.includes(o) : b.selected.includes(o);
                        return (
                          <button
                            key={o}
                            type="button"
                            className={`ai-poll__opt${picked ? ' is-picked' : ''}`}
                            disabled={done || busy}
                            aria-pressed={picked}
                            onClick={() => (b.poll.multiple ? togglePollOption(b.id, o) : answerPoll(b.id, [o]))}
                          >
                            {b.poll.multiple && <span className="ai-poll__box">{picked ? '✓' : ''}</span>}
                            {o}
                          </button>
                        );
                      })}
                    </div>
                    {b.poll.multiple && !done && (
                      <button type="button" className="btn btn--primary btn--sm ai-poll__send" disabled={busy || !b.selected.length} onClick={() => answerPoll(b.id, b.selected)}>
                        Ответить
                      </button>
                    )}
                    <div className="ai-poll__hint">
                      {done ? (b.answered!.length ? 'Ответ отправлен' : 'Пропущено') : 'Или напиши свой вариант в поле ниже'}
                    </div>
                  </li>
                );
              }
              if (b.kind === 'thinking') {
                return (
                  <li key={b.id} className="ai-bubble ai-bubble--thinking">
                    <span className="ai-dot" /> {b.text}
                  </li>
                );
              }
              // tool
              return (
                <li key={b.id} className={`ai-bubble ai-bubble--tool${b.status === 'running' ? ' is-running' : ''}`}>
                  <button type="button" className="ai-tool__head" onClick={() => toggleTool(b.id)}>
                    <span className="ai-tool__status">{b.status === 'running' ? '…' : '✓'}</span>
                    <span className="ai-tool__label">{b.label}</span>
                    <span className="ai-tool__chev">{b.open ? '▾' : '▸'}</span>
                  </button>
                  {b.open && typeof b.detail === 'string' && b.detail && (
                    <pre className="ai-tool__detail">{b.detail.length > 4000 ? `${b.detail.slice(0, 4000)}…` : b.detail}</pre>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div ref={bottomRef} />
      </div>

      <form
        className="ai-chat__composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          className="input ai-chat__input"
          value={input}
          disabled={busy}
          placeholder={t('ai.placeholder')}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" className="btn btn--primary" disabled={busy || !input.trim()}>
          {busy ? '…' : t('ai.send')}
        </button>
      </form>
    </div>
  );
}
