/**
 * Hardware detection and model selection for in-browser (WebLLM) inference.
 *
 * Browsers do not expose VRAM, so detection is heuristic: WebGPU adapter vendor/architecture,
 * adapter limits, shader-f16 support, device memory and platform are combined into a coarse tier.
 * The tier is then refined with what we learned on previous runs (measured decode speed),
 * what is already in the model cache and how much storage is available.
 */

export type DeviceTier = 'high' | 'mid' | 'low' | 'none';
export type ModelTier = Exclude<DeviceTier, 'none'>;
export type ModelPrecision = 'f16' | 'f32';

export type GpuAdapterSummary = {
  vendor: string;
  architecture: string;
  device: string;
  description: string;
  isFallbackAdapter: boolean;
  shaderF16: boolean;
  maxBufferSize?: number;
  maxStorageBufferBindingSize?: number;
};

export type DeviceProfile = {
  tier: DeviceTier;
  webgpu: boolean;
  gpu?: GpuAdapterSummary;
  /** Stable-ish key used to store per-device performance measurements. */
  gpuKey: string;
  deviceMemoryGb?: number;
  hardwareConcurrency?: number;
  platform?: string;
  mobile: boolean;
  reasons: string[];
};

export type ModelPerformanceRecord = {
  decodeTokensPerSecond: number;
  samples: number;
  updatedAt: string;
};

export type WebLlmModelSelection = {
  /** Model to load, or `null` when the device cannot run WebLLM. */
  model: string | null;
  /** Models to try, in order, when loading `model` fails (out of memory, device lost, ...). */
  fallbackModels: string[];
  /** Tier of the selected model. */
  tier: DeviceTier;
  /** Tier based on hardware detection alone, before cache/performance/storage adjustments. */
  detectedTier: DeviceTier;
  precision: ModelPrecision;
  cached: boolean;
  /** True when the selected model is small enough that extraction quality will noticeably drop. */
  lowAccuracy: boolean;
  reasons: string[];
  profile: DeviceProfile;
};

export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Models per tier. Sizes are WebLLM's `vram_required_MB`, used as a fallback when the prebuilt config is unavailable. */
export const WEB_LLM_MODEL_TIERS: Record<ModelTier, Record<ModelPrecision, { model: string; vramMB: number }>> = {
  high: {
    f16: { model: 'Qwen2.5-7B-Instruct-q4f16_1-MLC', vramMB: 5107 },
    f32: { model: 'Qwen2.5-7B-Instruct-q4f32_1-MLC', vramMB: 5900 }
  },
  mid: {
    f16: { model: 'Qwen2.5-3B-Instruct-q4f16_1-MLC', vramMB: 2505 },
    f32: { model: 'Qwen2.5-3B-Instruct-q4f32_1-MLC', vramMB: 2894 }
  },
  low: {
    f16: { model: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', vramMB: 1630 },
    f32: { model: 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC', vramMB: 1889 }
  }
};

const TIER_ORDER: ModelTier[] = ['high', 'mid', 'low'];
const MB = 1024 * 1024;
export const DEFAULT_MIN_DECODE_TOKENS_PER_SECOND = 4;
const PERFORMANCE_STORAGE_KEY = 'qti-convert-local-ai:model-performance';

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

type GpuAdapterLike = {
  info?: Partial<Record<'vendor' | 'architecture' | 'device' | 'description', string>>;
  requestAdapterInfo?: () => Promise<Partial<Record<'vendor' | 'architecture' | 'device' | 'description', string>>>;
  isFallbackAdapter?: boolean;
  features?: { has: (feature: string) => boolean };
  limits?: { maxBufferSize?: number; maxStorageBufferBindingSize?: number };
};

type NavigatorLike = {
  gpu?: { requestAdapter: (options?: { powerPreference?: 'high-performance' | 'low-power' }) => Promise<unknown> };
  deviceMemory?: number;
  hardwareConcurrency?: number;
  platform?: string;
  userAgent?: string;
  userAgentData?: { platform?: string; mobile?: boolean };
};

export type DetectionEnvironment = {
  navigator?: NavigatorLike;
};

const readAdapter = async (nav: NavigatorLike): Promise<GpuAdapterSummary | undefined> => {
  if (!nav.gpu?.requestAdapter) {
    return undefined;
  }
  // Ask for the high-performance adapter so hybrid laptops report the discrete GPU.
  const adapter = (await nav.gpu.requestAdapter({ powerPreference: 'high-performance' })) as GpuAdapterLike | null;
  if (!adapter) {
    return undefined;
  }
  let info = adapter.info;
  if (!info && typeof adapter.requestAdapterInfo === 'function') {
    info = await adapter.requestAdapterInfo().catch(() => undefined);
  }
  return {
    vendor: (info?.vendor || '').toLowerCase(),
    architecture: (info?.architecture || '').toLowerCase(),
    device: info?.device || '',
    description: info?.description || '',
    isFallbackAdapter: Boolean(adapter.isFallbackAdapter),
    shaderF16: Boolean(adapter.features?.has('shader-f16')),
    maxBufferSize: adapter.limits?.maxBufferSize,
    maxStorageBufferBindingSize: adapter.limits?.maxStorageBufferBindingSize
  };
};

const capTier = (tier: DeviceTier, cap: ModelTier): DeviceTier => {
  if (tier === 'none') return tier;
  return TIER_ORDER.indexOf(tier) < TIER_ORDER.indexOf(cap) ? cap : tier;
};

export type ClassifyDeviceInput = {
  gpu?: GpuAdapterSummary;
  deviceMemoryGb?: number;
  platform?: string;
  mobile?: boolean;
};

/** Pure classification so the heuristics can be unit tested without a browser. */
export const classifyDeviceTier = (input: ClassifyDeviceInput): { tier: DeviceTier; reasons: string[] } => {
  const reasons: string[] = [];
  const { gpu } = input;
  if (!gpu) {
    return { tier: 'none', reasons: ['WebGPU is not available in this browser.'] };
  }
  if (gpu.isFallbackAdapter) {
    return { tier: 'none', reasons: ['Only a software (fallback) WebGPU adapter is available.'] };
  }

  const label = `${gpu.vendor || 'unknown vendor'}${gpu.architecture ? ` / ${gpu.architecture}` : ''}`;
  let tier: DeviceTier;
  if (gpu.vendor === 'apple') {
    tier = 'high';
    reasons.push(`Apple GPU (${label}): unified memory, good WebGPU performance.`);
  } else if (gpu.vendor === 'nvidia') {
    tier = 'high';
    reasons.push(`NVIDIA GPU (${label}).`);
  } else if (gpu.vendor === 'amd') {
    const discrete = /\b(rx|radeon pro|instinct)\b/i.test(gpu.description);
    tier = discrete ? 'high' : 'mid';
    reasons.push(discrete ? `Discrete AMD GPU (${label}).` : `AMD GPU (${label}), possibly integrated.`);
  } else if (gpu.vendor === 'intel') {
    // Discrete Arc cards report an "hpg" architecture (xe-hpg, xe2-hpg); integrated GPUs report gen-*, xe-lp, xe-lpg, ...
    const discrete = gpu.architecture.includes('hpg');
    tier = discrete ? 'mid' : 'low';
    reasons.push(discrete ? `Intel Arc discrete GPU (${label}).` : `Intel integrated GPU (${label}).`);
  } else if (!gpu.vendor && /mac/i.test(input.platform || '')) {
    // Safari hides adapter info; could be Apple Silicon or an Intel Mac.
    tier = 'mid';
    reasons.push('GPU vendor hidden by the browser on macOS.');
  } else {
    tier = 'low';
    reasons.push(`Unknown or low-power GPU (${label}).`);
  }

  if (gpu.maxBufferSize !== undefined && gpu.maxBufferSize < 512 * MB) {
    tier = capTier(tier, 'low');
    reasons.push(`Small GPU buffer limit (${Math.round(gpu.maxBufferSize / MB)} MB).`);
  }
  if (input.deviceMemoryGb !== undefined) {
    if (input.deviceMemoryGb <= 4) {
      tier = capTier(tier, 'low');
      reasons.push(`Limited system memory (${input.deviceMemoryGb} GB reported).`);
    } else if (input.deviceMemoryGb < 8 && gpu.vendor === 'apple') {
      tier = capTier(tier, 'mid');
      reasons.push(`Less than 8 GB unified memory reported.`);
    }
  }
  if (input.mobile) {
    tier = capTier(tier, 'low');
    reasons.push('Mobile device.');
  }
  return { tier, reasons };
};

export const detectDeviceProfile = async (env: DetectionEnvironment = {}): Promise<DeviceProfile> => {
  const nav = env.navigator ?? ((globalThis as { navigator?: NavigatorLike }).navigator || {});
  let gpu: GpuAdapterSummary | undefined;
  try {
    gpu = await readAdapter(nav);
  } catch {
    gpu = undefined;
  }
  const platform = nav.userAgentData?.platform || nav.platform;
  const mobile = nav.userAgentData?.mobile ?? /Android|iPhone|iPad|Mobile/i.test(nav.userAgent || '');
  const deviceMemoryGb = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : undefined;
  const { tier, reasons } = classifyDeviceTier({ gpu, deviceMemoryGb, platform, mobile });
  return {
    tier,
    webgpu: Boolean(gpu),
    gpu,
    gpuKey: gpu ? [gpu.vendor, gpu.architecture, gpu.device, gpu.description].join('|') : 'none',
    deviceMemoryGb,
    hardwareConcurrency: nav.hardwareConcurrency,
    platform,
    mobile,
    reasons
  };
};

// ---------------------------------------------------------------------------
// Performance memory (learn from previous runs)
// ---------------------------------------------------------------------------

const defaultStorage = (): KeyValueStorage | undefined => {
  try {
    return (globalThis as { localStorage?: KeyValueStorage }).localStorage;
  } catch {
    return undefined;
  }
};

type PerformanceStore = Record<string, Record<string, ModelPerformanceRecord>>;

const readStore = (storage: KeyValueStorage | undefined): PerformanceStore => {
  try {
    const raw = storage?.getItem(PERFORMANCE_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PerformanceStore) : {};
  } catch {
    return {};
  }
};

export const loadModelPerformance = (
  gpuKey: string,
  storage: KeyValueStorage | undefined = defaultStorage()
): Record<string, ModelPerformanceRecord> => readStore(storage)[gpuKey] || {};

/** Stores a decode-speed measurement (exponential moving average) for a model on this GPU. */
export const recordModelPerformance = (
  gpuKey: string,
  model: string,
  decodeTokensPerSecond: number,
  storage: KeyValueStorage | undefined = defaultStorage()
): void => {
  if (!storage || !Number.isFinite(decodeTokensPerSecond) || decodeTokensPerSecond <= 0) return;
  try {
    const store = readStore(storage);
    const previous = store[gpuKey]?.[model];
    const next: ModelPerformanceRecord = previous
      ? {
          decodeTokensPerSecond: previous.decodeTokensPerSecond * 0.7 + decodeTokensPerSecond * 0.3,
          samples: previous.samples + 1,
          updatedAt: new Date().toISOString()
        }
      : { decodeTokensPerSecond, samples: 1, updatedAt: new Date().toISOString() };
    store[gpuKey] = { ...(store[gpuKey] || {}), [model]: next };
    storage.setItem(PERFORMANCE_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Storage full or blocked: performance memory is a convenience only.
  }
};

// ---------------------------------------------------------------------------
// Recommendation
// ---------------------------------------------------------------------------

export type RecommendModelOptions = {
  /** Model ids already present in the browser cache. */
  cachedModels?: Iterable<string>;
  /** Previous decode-speed measurements for this GPU, keyed by model id. */
  performance?: Record<string, ModelPerformanceRecord>;
  /** Free browser storage in MB; models that don't fit (and aren't cached) are skipped. */
  availableStorageMB?: number;
  /** Model size lookup in MB; defaults to the static table. */
  modelSizeMB?: (model: string) => number | undefined;
  /** Use an already-downloaded smaller model instead of downloading the recommended one. @default true */
  preferCachedModels?: boolean;
  /** Models measured slower than this on a previous run are skipped. @default 4 */
  minDecodeTokensPerSecond?: number;
};

const staticModelSize = (model: string): number | undefined => {
  for (const tier of TIER_ORDER) {
    for (const precision of ['f16', 'f32'] as const) {
      if (WEB_LLM_MODEL_TIERS[tier][precision].model === model) return WEB_LLM_MODEL_TIERS[tier][precision].vramMB;
    }
  }
  return undefined;
};

const tierOfModel = (model: string): ModelTier | undefined =>
  TIER_ORDER.find(
    tier => WEB_LLM_MODEL_TIERS[tier].f16.model === model || WEB_LLM_MODEL_TIERS[tier].f32.model === model
  );

export const recommendWebLlmModel = (
  profile: DeviceProfile,
  options: RecommendModelOptions = {}
): WebLlmModelSelection => {
  const precision: ModelPrecision = profile.gpu?.shaderF16 ? 'f16' : 'f32';
  const reasons = [...profile.reasons];
  if (profile.gpu && precision === 'f32') {
    reasons.push('No shader-f16 support: using q4f32 model variants.');
  }

  if (profile.tier === 'none') {
    return {
      model: null,
      fallbackModels: [],
      tier: 'none',
      detectedTier: 'none',
      precision,
      cached: false,
      lowAccuracy: true,
      reasons,
      profile
    };
  }

  const cached = new Set(options.cachedModels ?? []);
  const sizeOf = (model: string) => options.modelSizeMB?.(model) ?? staticModelSize(model);
  const minTps = options.minDecodeTokensPerSecond ?? DEFAULT_MIN_DECODE_TOKENS_PER_SECOND;
  let candidates = TIER_ORDER.slice(TIER_ORDER.indexOf(profile.tier)).map(
    tier => WEB_LLM_MODEL_TIERS[tier][precision].model
  );

  // 1. Skip models that were too slow on this GPU before (always keep the smallest).
  while (candidates.length > 1) {
    const measured = options.performance?.[candidates[0]];
    if (!measured || measured.decodeTokensPerSecond >= minTps) break;
    reasons.push(
      `${candidates[0]} ran at ${measured.decodeTokensPerSecond.toFixed(1)} tokens/s on this device before; using a smaller model.`
    );
    candidates = candidates.slice(1);
  }

  // 2. Skip models that need a download that does not fit in the available storage.
  if (options.availableStorageMB !== undefined) {
    while (candidates.length > 1 && !cached.has(candidates[0])) {
      const size = sizeOf(candidates[0]);
      if (size === undefined || size <= options.availableStorageMB) break;
      reasons.push(
        `Not enough browser storage for ${candidates[0]} (~${Math.round(size)} MB needed, ${Math.round(options.availableStorageMB)} MB free).`
      );
      candidates = candidates.slice(1);
    }
  }

  // 3. Prefer a smaller model that is already downloaded over a large download.
  if ((options.preferCachedModels ?? true) && !cached.has(candidates[0])) {
    const cachedIndex = candidates.findIndex(model => cached.has(model));
    if (cachedIndex > 0) {
      reasons.push(`Using cached ${candidates[cachedIndex]} instead of downloading ${candidates[0]}.`);
      candidates = candidates.slice(cachedIndex);
    }
  }

  const model = candidates[0];
  const tier = tierOfModel(model) ?? profile.tier;
  return {
    model,
    fallbackModels: candidates.slice(1),
    tier,
    detectedTier: profile.tier,
    precision,
    cached: cached.has(model),
    lowAccuracy: tier === 'low',
    reasons,
    profile
  };
};

// ---------------------------------------------------------------------------
// Full selection in the browser (detection + cache + storage + performance)
// ---------------------------------------------------------------------------

export type SelectWebLlmModelOptions = Omit<
  RecommendModelOptions,
  'cachedModels' | 'performance' | 'availableStorageMB'
> &
  DetectionEnvironment & {
    storage?: KeyValueStorage;
    /** Ask the browser to keep the model cache from being evicted. @default true */
    persistStorage?: boolean;
  };

type WebLlmModule = {
  hasModelInCache?: (modelId: string) => Promise<boolean>;
  prebuiltAppConfig?: { model_list?: Array<{ model_id: string; vram_required_MB?: number }> };
};

const loadWebLlmModule = async (): Promise<WebLlmModule | undefined> => {
  try {
    return (await import('@mlc-ai/web-llm')) as unknown as WebLlmModule;
  } catch {
    return undefined;
  }
};

export const selectWebLlmModel = async (options: SelectWebLlmModelOptions = {}): Promise<WebLlmModelSelection> => {
  const profile = await detectDeviceProfile(options);
  if (profile.tier === 'none') {
    return recommendWebLlmModel(profile, options);
  }

  const nav = (options.navigator ?? (globalThis as { navigator?: unknown }).navigator) as
    | { storage?: { estimate?: () => Promise<{ quota?: number; usage?: number }>; persist?: () => Promise<boolean> } }
    | undefined;
  const webllm = await loadWebLlmModule();
  const allModels = TIER_ORDER.flatMap(tier => [
    WEB_LLM_MODEL_TIERS[tier].f16.model,
    WEB_LLM_MODEL_TIERS[tier].f32.model
  ]);

  const cachedModels: string[] = [];
  if (webllm?.hasModelInCache) {
    await Promise.all(
      allModels.map(async model => {
        if (await webllm.hasModelInCache!(model).catch(() => false)) cachedModels.push(model);
      })
    );
  }

  let availableStorageMB: number | undefined;
  try {
    const estimate = await nav?.storage?.estimate?.();
    if (estimate?.quota !== undefined) {
      availableStorageMB = (estimate.quota - (estimate.usage ?? 0)) / MB;
    }
  } catch {
    availableStorageMB = undefined;
  }

  const prebuiltSizes = new Map(
    (webllm?.prebuiltAppConfig?.model_list || [])
      .filter(record => typeof record.vram_required_MB === 'number')
      .map(record => [record.model_id, record.vram_required_MB as number])
  );

  const selection = recommendWebLlmModel(profile, {
    ...options,
    cachedModels,
    availableStorageMB,
    performance: loadModelPerformance(profile.gpuKey, options.storage ?? defaultStorage()),
    modelSizeMB: options.modelSizeMB ?? (model => prebuiltSizes.get(model))
  });

  if (selection.model && !selection.cached && (options.persistStorage ?? true)) {
    await nav?.storage?.persist?.().catch(() => false);
  }
  return selection;
};

// ---------------------------------------------------------------------------
// Load-failure classification (used for automatic step-down)
// ---------------------------------------------------------------------------

/** Errors where retrying with a smaller model is likely to help. */
export const isModelResourceError = (error: unknown): boolean => {
  const name = (error as { name?: string })?.name || '';
  const message = (error as { message?: string })?.message || String(error ?? '');
  if (['DeviceLostError', 'ShaderF16SupportError', 'FeatureSupportError'].includes(name)) return true;
  return /out of memory|\boom\b|device (was )?lost|failed to allocate|allocation failed|maxStorageBufferBindingSize|maxBufferSize|shader-f16/i.test(
    message
  );
};

export const isShaderF16Error = (error: unknown): boolean =>
  (error as { name?: string })?.name === 'ShaderF16SupportError' ||
  /shader-f16/i.test((error as { message?: string })?.message || '');

/** Maps a q4f16 model id to its q4f32 counterpart (no-op for other ids). */
export const toF32Variant = (model: string): string => model.replace(/q4f16_1/, 'q4f32_1');
