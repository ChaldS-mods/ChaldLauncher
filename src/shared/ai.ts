export type AiProviderId = 'gemini' | 'groq' | 'openai' | 'openrouter' | 'custom';

export interface AiProviderInfo {
  id: AiProviderId;
  label: string;
  /** default OpenAI-compatible base URL; empty for native Gemini */
  defaultBaseUrl: string;
  defaultModel: string;
  /** docs / key URL for UI hint */
  keyUrl: string;
}

export const AI_PROVIDERS: AiProviderInfo[] = [
  { id: 'gemini', label: 'Google Gemini', defaultBaseUrl: '', defaultModel: 'gemini-2.0-flash', keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'groq', label: 'Groq', defaultBaseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile', keyUrl: 'https://console.groq.com/keys' },
  { id: 'openai', label: 'OpenAI', defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini', keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'openrouter', label: 'OpenRouter', defaultBaseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'google/gemini-2.0-flash-001', keyUrl: 'https://openrouter.ai/keys' },
  { id: 'custom', label: 'Custom (OpenAI-compatible)', defaultBaseUrl: 'http://127.0.0.1:1234/v1', defaultModel: 'local-model', keyUrl: '' },
];

export type AiRole = 'system' | 'user' | 'assistant' | 'tool';

export interface AiToolCall {
  id: string;
  name: string;
  arguments: string; // JSON string
}

export interface AiMessage {
  id: string;
  role: AiRole;
  content: string;
  /** tool calls requested by the assistant */
  toolCalls?: AiToolCall[];
  /** for role=tool */
  toolCallId?: string;
  toolName?: string;
  /** unix ms */
  at: number;
}

export interface AiChatRequest {
  messages: { role: AiRole; content: string; toolCalls?: AiToolCall[]; toolCallId?: string; toolName?: string }[];
}

export interface AiChatStep {
  /** assistant text for this step (may be empty if only tools) */
  content: string;
  toolCalls: AiToolCall[];
  /** results after tools ran (name + JSON result text) */
  toolResults: { toolCallId: string; name: string; result: string }[];
  /** final assistant text after tools (if any) */
  finalContent?: string;
}

/** A question with clickable answers that the agent puts to the user (tool `ask_user`). */
export interface AiPoll {
  id: string;
  question: string;
  options: string[];
  /** several options may be chosen */
  multiple: boolean;
}

export interface AiChatResponse {
  steps: AiChatStep[];
  /** concatenated user-visible assistant reply */
  reply: string;
  /** set when the agent asked a poll: the turn ended and waits for the answer (sent as the next user message) */
  poll?: AiPoll;
}


/** Live agent step for the UI (tool start / tool result / text). */
export type AiProgressKind = 'thinking' | 'tool_start' | 'tool_result' | 'text';

export interface AiProgressEvent {
  kind: AiProgressKind;
  /** Russian label for the UI, e.g. «Ищу моды» */
  label: string;
  toolName?: string;
  toolCallId?: string;
  /** short or full payload (tool args / result / assistant text) */
  detail?: string;
}
