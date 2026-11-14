"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AI_PROVIDERS = void 0;
exports.AI_PROVIDERS = [
    { id: 'gemini', label: 'Google Gemini', defaultBaseUrl: '', defaultModel: 'gemini-2.0-flash', keyUrl: 'https://aistudio.google.com/apikey' },
    { id: 'groq', label: 'Groq', defaultBaseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile', keyUrl: 'https://console.groq.com/keys' },
    { id: 'openai', label: 'OpenAI', defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini', keyUrl: 'https://platform.openai.com/api-keys' },
    { id: 'openrouter', label: 'OpenRouter', defaultBaseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'google/gemini-2.0-flash-001', keyUrl: 'https://openrouter.ai/keys' },
    { id: 'custom', label: 'Custom (OpenAI-compatible)', defaultBaseUrl: 'http://127.0.0.1:1234/v1', defaultModel: 'local-model', keyUrl: '' },
];
//# sourceMappingURL=ai.js.map