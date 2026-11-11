import { describe, expect, test, vi } from 'vitest';
import { createLocalServerEngine, detectLocalLlmServers, isLoopbackUrl } from '../src/local-server';
import { createWebLlmEngine } from '../src/mapping';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const completion = (content: string) => ({ choices: [{ message: { content } }] });

describe('isLoopbackUrl', () => {
  test.each([
    ['http://localhost:11434/v1', true],
    ['http://127.0.0.1:1234/v1', true],
    ['http://[::1]:8080/v1', true],
    ['http://ollama.localhost/v1', true],
    ['http://192.168.1.10:11434/v1', false],
    ['https://api.example.com/v1', false],
    ['not a url', false]
  ])('%s → %s', (url, expected) => {
    expect(isLoopbackUrl(url)).toBe(expected);
  });
});

describe('createLocalServerEngine', () => {
  test('sends OpenAI-compatible chat requests to the server', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/models')) return json({ data: [{ id: 'qwen2.5:7b' }] });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: 'qwen2.5:7b',
        temperature: 0,
        response_format: { type: 'json_object' }
      });
      return json(completion('{"ok":true}'));
    });
    const engine = await createLocalServerEngine({
      baseUrl: 'http://localhost:11434/v1/',
      model: 'qwen2.5:7b',
      fetch: fetchMock as unknown as typeof fetch
    });
    const response = await engine.chat.completions.create({
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0,
      response_format: { type: 'json_object' }
    });
    expect(response.choices?.[0]?.message?.content).toBe('{"ok":true}');
    expect(fetchMock.mock.calls[1][0]).toBe('http://localhost:11434/v1/chat/completions');
  });

  test('drops response_format after the server rejects it', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/models')) return json({ data: [] });
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      return body.response_format ? json({ error: 'unsupported' }, 400) : json(completion('{}'));
    });
    const engine = await createLocalServerEngine({
      baseUrl: 'http://localhost:1234/v1',
      model: 'any',
      fetch: fetchMock as unknown as typeof fetch
    });
    const request = {
      messages: [{ role: 'user' as const, content: 'x' }],
      response_format: { type: 'json_object' as const }
    };
    await engine.chat.completions.create(request);
    await engine.chat.completions.create(request);
    expect(bodies.map(body => 'response_format' in body)).toEqual([true, false, false]);
  });

  test('refuses non-local hosts unless allowed', async () => {
    await expect(createLocalServerEngine({ baseUrl: 'https://api.example.com/v1', model: 'x' })).rejects.toThrow(
      /non-local/
    );
  });

  test('reports a missing model with the available ones', async () => {
    const fetchMock = vi.fn(async () => json({ data: [{ id: 'llama3.2:3b' }] }));
    await expect(
      createLocalServerEngine({
        baseUrl: 'http://localhost:11434/v1',
        model: 'qwen2.5:7b',
        fetch: fetchMock as unknown as typeof fetch
      })
    ).rejects.toThrow(/llama3\.2:3b/);
  });
});

describe('detectLocalLlmServers', () => {
  test('returns only responding servers with their models', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('http://localhost:11434')) return json({ data: [{ id: 'qwen2.5:7b' }] });
      throw new TypeError('Failed to fetch');
    });
    const servers = await detectLocalLlmServers({ fetch: fetchMock as unknown as typeof fetch });
    expect(servers).toEqual([{ name: 'Ollama', baseUrl: 'http://localhost:11434/v1', models: ['qwen2.5:7b'] }]);
  });
});

describe('createWebLlmEngine with localServer', () => {
  test('uses the local server instead of WebLLM', async () => {
    const fetchMock = vi.fn(async () => json({ data: [{ id: 'qwen2.5:7b' }] }));
    const stages: string[] = [];
    await createWebLlmEngine(
      {
        localServer: {
          baseUrl: 'http://localhost:11434/v1',
          model: 'qwen2.5:7b',
          fetch: fetchMock as unknown as typeof fetch
        }
      },
      event => stages.push(event.stage)
    );
    expect(stages).toEqual(['llm_loading_started', 'llm_loading_completed']);
  });

  test('throws when the server is down and fallback is disabled', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(
      createWebLlmEngine({
        localServer: {
          baseUrl: 'http://localhost:11434/v1',
          model: 'qwen2.5:7b',
          fallbackToWebLlm: false,
          fetch: fetchMock as unknown as typeof fetch
        }
      })
    ).rejects.toThrow('Failed to fetch');
  });
});
