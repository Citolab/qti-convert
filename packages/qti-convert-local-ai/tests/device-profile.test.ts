import { describe, expect, test, vi, beforeEach } from 'vitest';
import {
  DeviceProfile,
  GpuAdapterSummary,
  KeyValueStorage,
  WEB_LLM_MODEL_TIERS,
  classifyDeviceTier,
  detectDeviceProfile,
  isModelResourceError,
  loadModelPerformance,
  recommendWebLlmModel,
  recordModelPerformance
} from '../src/device-profile';

const webllmMock = vi.hoisted(() => ({
  CreateMLCEngine: vi.fn(),
  CreateWebWorkerMLCEngine: vi.fn(),
  hasModelInCache: vi.fn(async () => false),
  prebuiltAppConfig: { model_list: [] }
}));
vi.mock('@mlc-ai/web-llm', () => webllmMock);

const gpu = (overrides: Partial<GpuAdapterSummary> = {}): GpuAdapterSummary => ({
  vendor: 'nvidia',
  architecture: 'ampere',
  device: '',
  description: '',
  isFallbackAdapter: false,
  shaderF16: true,
  maxBufferSize: 4 * 1024 ** 3,
  ...overrides
});

const profileFor = (gpuSummary: GpuAdapterSummary | undefined, extra: Partial<DeviceProfile> = {}): DeviceProfile => {
  const { tier, reasons } = classifyDeviceTier({ gpu: gpuSummary, ...extra });
  return { tier, reasons, webgpu: Boolean(gpuSummary), gpu: gpuSummary, gpuKey: 'test-gpu', mobile: false, ...extra };
};

const memoryStorage = (): KeyValueStorage => {
  const data = new Map<string, string>();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
};

describe('classifyDeviceTier', () => {
  test.each([
    ['apple', 'metal-3', '', 'high'],
    ['nvidia', 'ampere', '', 'high'],
    ['amd', 'rdna-3', 'AMD Radeon RX 7800 XT', 'high'],
    ['amd', 'rdna-2', 'AMD Radeon(TM) Graphics', 'mid'],
    ['intel', 'xe-hpg', 'Intel Arc A770', 'mid'],
    ['intel', 'gen-12lp', 'Intel Iris Xe', 'low'],
    ['qualcomm', 'adreno', '', 'low']
  ])('%s / %s → %s', (vendor, architecture, description, expected) => {
    expect(classifyDeviceTier({ gpu: gpu({ vendor, architecture, description }) }).tier).toBe(expected);
  });

  test('no WebGPU or a fallback adapter means no local AI', () => {
    expect(classifyDeviceTier({}).tier).toBe('none');
    expect(classifyDeviceTier({ gpu: gpu({ isFallbackAdapter: true }) }).tier).toBe('none');
  });

  test('caps tier on low memory, small buffers and mobile', () => {
    expect(classifyDeviceTier({ gpu: gpu(), deviceMemoryGb: 4 }).tier).toBe('low');
    expect(classifyDeviceTier({ gpu: gpu({ vendor: 'apple' }), deviceMemoryGb: 6 }).tier).toBe('mid');
    expect(classifyDeviceTier({ gpu: gpu({ maxBufferSize: 256 * 1024 ** 2 }) }).tier).toBe('low');
    expect(classifyDeviceTier({ gpu: gpu(), mobile: true }).tier).toBe('low');
  });
});

describe('detectDeviceProfile', () => {
  test('reads WebGPU adapter info and limits', async () => {
    const requestAdapter = vi.fn(async () => ({
      info: { vendor: 'Intel', architecture: 'gen-12lp', device: '', description: '' },
      isFallbackAdapter: false,
      features: { has: (feature: string) => feature === 'shader-f16' },
      limits: { maxBufferSize: 2 * 1024 ** 3, maxStorageBufferBindingSize: 2 * 1024 ** 3 }
    }));
    const profile = await detectDeviceProfile({
      navigator: { gpu: { requestAdapter }, deviceMemory: 8, platform: 'Win32', userAgent: 'Windows' }
    });
    expect(requestAdapter).toHaveBeenCalledWith({ powerPreference: 'high-performance' });
    expect(profile.tier).toBe('low');
    expect(profile.gpu?.shaderF16).toBe(true);
    expect(profile.gpuKey).toContain('intel');
  });

  test('handles browsers without WebGPU', async () => {
    const profile = await detectDeviceProfile({ navigator: {} });
    expect(profile.tier).toBe('none');
    expect(profile.webgpu).toBe(false);
  });
});

describe('recommendWebLlmModel', () => {
  test('picks the tier model and smaller fallbacks', () => {
    const selection = recommendWebLlmModel(profileFor(gpu()));
    expect(selection.model).toBe(WEB_LLM_MODEL_TIERS.high.f16.model);
    expect(selection.fallbackModels).toEqual([WEB_LLM_MODEL_TIERS.mid.f16.model, WEB_LLM_MODEL_TIERS.low.f16.model]);
    expect(selection.lowAccuracy).toBe(false);
  });

  test('uses q4f32 variants without shader-f16', () => {
    const selection = recommendWebLlmModel(
      profileFor(gpu({ vendor: 'intel', architecture: 'gen-12lp', shaderF16: false }))
    );
    expect(selection.model).toBe(WEB_LLM_MODEL_TIERS.low.f32.model);
    expect(selection.lowAccuracy).toBe(true);
  });

  test('returns no model when WebGPU is unavailable', () => {
    expect(recommendWebLlmModel(profileFor(undefined)).model).toBeNull();
  });

  test('skips models measured too slow before', () => {
    const selection = recommendWebLlmModel(profileFor(gpu()), {
      performance: {
        [WEB_LLM_MODEL_TIERS.high.f16.model]: { decodeTokensPerSecond: 1.5, samples: 3, updatedAt: '' }
      }
    });
    expect(selection.model).toBe(WEB_LLM_MODEL_TIERS.mid.f16.model);
    expect(selection.detectedTier).toBe('high');
  });

  test('prefers an already cached smaller model', () => {
    const selection = recommendWebLlmModel(profileFor(gpu()), { cachedModels: [WEB_LLM_MODEL_TIERS.mid.f16.model] });
    expect(selection.model).toBe(WEB_LLM_MODEL_TIERS.mid.f16.model);
    expect(selection.cached).toBe(true);
    expect(
      recommendWebLlmModel(profileFor(gpu()), {
        cachedModels: [WEB_LLM_MODEL_TIERS.mid.f16.model],
        preferCachedModels: false
      }).model
    ).toBe(WEB_LLM_MODEL_TIERS.high.f16.model);
  });

  test('skips downloads that do not fit in free storage', () => {
    const selection = recommendWebLlmModel(profileFor(gpu()), { availableStorageMB: 3000 });
    expect(selection.model).toBe(WEB_LLM_MODEL_TIERS.mid.f16.model);
  });
});

describe('performance memory', () => {
  test('stores a moving average per GPU and model', () => {
    const storage = memoryStorage();
    recordModelPerformance('gpu-a', 'model-x', 10, storage);
    recordModelPerformance('gpu-a', 'model-x', 20, storage);
    const record = loadModelPerformance('gpu-a', storage)['model-x'];
    expect(record.samples).toBe(2);
    expect(record.decodeTokensPerSecond).toBeCloseTo(13);
    expect(loadModelPerformance('gpu-b', storage)).toEqual({});
  });
});

describe('isModelResourceError', () => {
  test('recognises out-of-memory style failures only', () => {
    const deviceLost = Object.assign(new Error('The WebGPU device was lost'), { name: 'DeviceLostError' });
    expect(isModelResourceError(deviceLost)).toBe(true);
    expect(isModelResourceError(new Error('GPUOutOfMemoryError: out of memory'))).toBe(true);
    expect(isModelResourceError(new Error('Failed to fetch'))).toBe(false);
  });
});

describe('createWebLlmEngine step-down', () => {
  beforeEach(async () => {
    const { releaseWebLlmEngines } = await import('../src/mapping');
    await releaseWebLlmEngines();
    webllmMock.CreateMLCEngine.mockReset();
    webllmMock.CreateWebWorkerMLCEngine.mockReset();
  });

  const fakeEngine = () => ({ chat: { completions: { create: vi.fn(async () => ({ choices: [] })) } } });

  test('retries with the next model after a device-lost error', async () => {
    const { createWebLlmEngine } = await import('../src/mapping');
    webllmMock.CreateMLCEngine.mockImplementation(async (model: string) => {
      if (model === 'big') throw Object.assign(new Error('device lost'), { name: 'DeviceLostError' });
      return fakeEngine();
    });
    const events: Array<{ stage: string; data?: unknown }> = [];
    await createWebLlmEngine({ model: 'big', fallbackModels: ['small'], recordPerformance: false }, event =>
      events.push(event)
    );
    expect(webllmMock.CreateMLCEngine.mock.calls.map(call => call[0])).toEqual(['big', 'small']);
    expect(events.at(-1)).toMatchObject({
      stage: 'llm_loading_completed',
      data: { model: 'small', failedModels: ['big'] }
    });
  });

  test('switches to q4f32 after a shader-f16 error', async () => {
    const { createWebLlmEngine } = await import('../src/mapping');
    webllmMock.CreateMLCEngine.mockImplementation(async (model: string) => {
      if (model.includes('q4f16'))
        throw Object.assign(new Error('requires shader-f16'), { name: 'ShaderF16SupportError' });
      return fakeEngine();
    });
    await createWebLlmEngine({ model: WEB_LLM_MODEL_TIERS.mid.f16.model, recordPerformance: false });
    expect(webllmMock.CreateMLCEngine.mock.calls.map(call => call[0])).toEqual([
      WEB_LLM_MODEL_TIERS.mid.f16.model,
      WEB_LLM_MODEL_TIERS.mid.f32.model
    ]);
  });

  test('does not step down on unrelated errors', async () => {
    const { createWebLlmEngine } = await import('../src/mapping');
    webllmMock.CreateMLCEngine.mockRejectedValue(new Error('Failed to fetch'));
    await expect(
      createWebLlmEngine({ model: 'big', fallbackModels: ['small'], recordPerformance: false })
    ).rejects.toThrow('Failed to fetch');
    expect(webllmMock.CreateMLCEngine).toHaveBeenCalledTimes(1);
  });

  test('reuses a loaded engine for the same model', async () => {
    const { createWebLlmEngine } = await import('../src/mapping');
    webllmMock.CreateMLCEngine.mockImplementation(async () => fakeEngine());
    const first = await createWebLlmEngine({ model: 'small', recordPerformance: false });
    const second = await createWebLlmEngine({ model: 'small', recordPerformance: false });
    expect(second).toBe(first);
    expect(webllmMock.CreateMLCEngine).toHaveBeenCalledTimes(1);
    await createWebLlmEngine({ model: 'small', recordPerformance: false, reuseEngine: false });
    expect(webllmMock.CreateMLCEngine).toHaveBeenCalledTimes(2);
  });

  test('does not cache failed loads', async () => {
    const { createWebLlmEngine } = await import('../src/mapping');
    webllmMock.CreateMLCEngine.mockRejectedValueOnce(new Error('Failed to fetch'));
    await expect(createWebLlmEngine({ model: 'small', recordPerformance: false })).rejects.toThrow();
    webllmMock.CreateMLCEngine.mockImplementation(async () => fakeEngine());
    await createWebLlmEngine({ model: 'small', recordPerformance: false });
    expect(webllmMock.CreateMLCEngine).toHaveBeenCalledTimes(2);
  });

  test('uses the web worker engine when a worker is provided', async () => {
    const { createWebLlmEngine } = await import('../src/mapping');
    webllmMock.CreateWebWorkerMLCEngine.mockResolvedValue(fakeEngine());
    const worker = { terminate: vi.fn() } as unknown as Worker;
    await createWebLlmEngine({ model: 'small', worker, recordPerformance: false });
    expect(webllmMock.CreateWebWorkerMLCEngine).toHaveBeenCalledWith(worker, 'small', expect.any(Object));
    expect(webllmMock.CreateMLCEngine).not.toHaveBeenCalled();
  });
});
