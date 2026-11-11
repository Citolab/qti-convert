/**
 * OpenAI-compatible local LLM server backend (Ollama, LM Studio, llama.cpp server).
 *
 * Native runtimes are much faster than in-browser WebGPU on typical Windows hardware while
 * keeping everything on the device. By default only loopback hosts are accepted so documents
 * cannot accidentally be sent to a remote server.
 */
import type { LocalServerSettings } from './types';
import type { WebLlmLikeEngine } from './mapping';

export type LocalServerInfo = {
  baseUrl: string;
  name: string;
  models: string[];
};

export const KNOWN_LOCAL_SERVERS: Array<{ name: string; baseUrl: string }> = [
  { name: 'Ollama', baseUrl: 'http://localhost:11434/v1' },
  { name: 'LM Studio', baseUrl: 'http://localhost:1234/v1' },
  { name: 'llama.cpp server', baseUrl: 'http://localhost:8080/v1' }
];

const DEFAULT_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_PROBE_TIMEOUT_MS = 1500;

export const isLoopbackUrl = (url: string): boolean => {
  try {
    const { hostname } = new URL(url);
    const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127(\.\d{1,3}){3}$/.test(host);
  } catch {
    return false;
  }
};

const trimSlash = (url: string) => url.replace(/\/+$/, '');

const fetchWithTimeout = async (
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const headersFor = (apiKey?: string): Record<string, string> => ({
  'Content-Type': 'application/json',
  ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
});

const listModels = async (
  baseUrl: string,
  options: { apiKey?: string; timeoutMs?: number; fetch?: typeof fetch } = {}
): Promise<string[]> => {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const response = await fetchWithTimeout(
    fetchImpl,
    `${trimSlash(baseUrl)}/models`,
    { headers: headersFor(options.apiKey) },
    options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS
  );
  if (!response.ok) {
    throw new Error(`Local LLM server at ${baseUrl} returned ${response.status} ${response.statusText}.`);
  }
  const body = (await response.json()) as { data?: Array<{ id?: string }> };
  return (body.data || []).map(model => model.id).filter((id): id is string => Boolean(id));
};

/**
 * Probes the well-known local servers (or the given base URLs) and returns the ones that respond,
 * with their models. Servers must allow the page origin via CORS (e.g. `OLLAMA_ORIGINS`).
 */
export const detectLocalLlmServers = async (
  options: { candidates?: Array<{ name: string; baseUrl: string }>; timeoutMs?: number; fetch?: typeof fetch } = {}
): Promise<LocalServerInfo[]> => {
  const candidates = options.candidates ?? KNOWN_LOCAL_SERVERS;
  const results = await Promise.all(
    candidates.map(async candidate => {
      try {
        const models = await listModels(candidate.baseUrl, options);
        return { ...candidate, models };
      } catch {
        return undefined;
      }
    })
  );
  return results.filter((result): result is LocalServerInfo => Boolean(result));
};

type ReportProgress = (event: {
  stage: 'llm_loading_started' | 'llm_loading_completed';
  message: string;
  data?: unknown;
}) => void;

export const createLocalServerEngine = async (
  config: LocalServerSettings,
  reportProgress?: ReportProgress
): Promise<WebLlmLikeEngine> => {
  const baseUrl = trimSlash(config.baseUrl);
  if (!config.allowRemoteHost && !isLoopbackUrl(baseUrl)) {
    throw new Error(
      `Refusing to send documents to non-local LLM server ${baseUrl}. Set localServer.allowRemoteHost to allow it.`
    );
  }
  const fetchImpl = config.fetch ?? globalThis.fetch;

  reportProgress?.({
    stage: 'llm_loading_started',
    message: `Connecting to local LLM server ${baseUrl} (model ${config.model}).`
  });
  const models = await listModels(baseUrl, { apiKey: config.apiKey, fetch: fetchImpl });
  if (models.length > 0 && !models.includes(config.model)) {
    throw new Error(`Model ${config.model} is not available on ${baseUrl}. Available: ${models.join(', ')}.`);
  }

  // Not every server accepts response_format json_object (LM Studio only supports json_schema);
  // after one rejection we stop sending it and rely on the prompt + JSON extraction.
  let sendResponseFormat = true;

  const post = (body: Record<string, unknown>) =>
    fetchWithTimeout(
      fetchImpl,
      `${baseUrl}/chat/completions`,
      { method: 'POST', headers: headersFor(config.apiKey), body: JSON.stringify(body) },
      config.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    );

  const engine: WebLlmLikeEngine = {
    chat: {
      completions: {
        create: async request => {
          const body: Record<string, unknown> = {
            model: config.model,
            messages: request.messages,
            temperature: request.temperature,
            stream: false
          };
          const wantsJson = Boolean(request.response_format);
          let response = await post(
            wantsJson && sendResponseFormat ? { ...body, response_format: request.response_format } : body
          );
          if (wantsJson && sendResponseFormat && (response.status === 400 || response.status === 422)) {
            sendResponseFormat = false;
            response = await post(body);
          }
          if (!response.ok) {
            const detail = await response.text().catch(() => '');
            throw new Error(
              `Local LLM server request failed: ${response.status} ${response.statusText}${detail ? ` - ${detail.slice(0, 300)}` : ''}`
            );
          }
          return (await response.json()) as Awaited<ReturnType<WebLlmLikeEngine['chat']['completions']['create']>>;
        }
      }
    }
  };

  reportProgress?.({
    stage: 'llm_loading_completed',
    message: `Connected to local LLM server ${baseUrl} (model ${config.model}).`,
    data: { model: config.model, backend: 'local-server', baseUrl }
  });
  return engine;
};
