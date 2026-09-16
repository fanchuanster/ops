export interface ChatClient {
  model: string
  complete(system: string, user: string): Promise<string>
}

export class LlmError extends Error {}

interface ProviderSpec {
  baseUrl: string
  model: string
  keyVar: string
  keyRequired: boolean
}

const PROVIDERS: Record<string, ProviderSpec> = {
  xai: {
    baseUrl: 'https://api.x.ai/v1',
    model: 'grok-4.20-0309-non-reasoning',
    keyVar: 'XAI_API_KEY',
    keyRequired: true,
  },
  vllm: {
    baseUrl: '',
    model: 'google/gemma-4-31B-it-qat-w4a16-ct',
    keyVar: 'VLLM_API_KEY',
    keyRequired: false,
  },
}

const RETRY_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504])

export interface LlmConfig {
  provider: string
  baseUrl: string
  model: string
  apiKey: string
  timeoutMs: number
  maxRetries: number
  jsonMode: boolean
}

type Env = Record<string, unknown>

function read(env: Env, name: string): string | undefined {
  const value = env[name]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function llmConfigFromEnv(env: Env): LlmConfig {
  const provider = (read(env, 'LLM_PROVIDER') ?? 'xai').toLowerCase()
  const spec = PROVIDERS[provider]
  if (!spec) {
    throw new LlmError(
      `unknown LLM_PROVIDER ${JSON.stringify(provider)} — expected one of ` +
        Object.keys(PROVIDERS).sort().join(', '),
    )
  }

  const prefix = provider.toUpperCase()

  const baseUrl = (
    read(env, 'LLM_BASE_URL') ??
    read(env, `${prefix}_BASE_URL`) ??
    spec.baseUrl
  ).replace(/\/+$/, '')
  if (!baseUrl) {
    throw new LlmError(
      `${prefix}_BASE_URL is not set. The ${provider} endpoint has no ` +
        'default address — it is deployment configuration.',
    )
  }

  const apiKey = read(env, 'LLM_API_KEY') ?? read(env, spec.keyVar) ?? ''
  if (!apiKey && spec.keyRequired) {
    throw new LlmError(`${spec.keyVar} is not set.`)
  }

  return {
    provider,
    baseUrl,
    model: read(env, 'LLM_MODEL') ?? read(env, `${prefix}_MODEL`) ?? spec.model,
    apiKey,
    timeoutMs: Number(read(env, 'LLM_TIMEOUT_MS') ?? 120_000),
    maxRetries: Number(read(env, 'LLM_MAX_RETRIES') ?? 4),
    jsonMode: !['0', 'false', 'no'].includes((read(env, 'LLM_JSON_MODE') ?? '1').toLowerCase()),
  }
}

export function llmConfigured(env: Env): boolean {
  try {
    llmConfigFromEnv(env)
    return true
  } catch {
    return false
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function createChatClient(config: LlmConfig): ChatClient {
  return {
    model: config.model,

    async complete(system: string, user: string): Promise<string> {
      const payload: Record<string, unknown> = {
        model: config.model,
        temperature: 0,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }
      if (config.jsonMode) payload.response_format = { type: 'json_object' }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`

      let lastError = 'no attempt was made'

      for (let attempt = 0; attempt < config.maxRetries; attempt += 1) {
        let response: Response
        try {
          response = await fetch(`${config.baseUrl}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(config.timeoutMs),
          })
        } catch (error) {
          lastError = (error as Error).message
          if (attempt === config.maxRetries - 1) break
          await sleep(2 ** attempt * 1000)
          continue
        }

        if (response.ok) return extractContent(await response.json())

        lastError = `HTTP ${response.status}: ${(await response.text()).slice(0, 400)}`
        if (!RETRY_STATUSES.has(response.status)) break

        const after = response.headers.get('Retry-After')
        const delay = after && /^\d+$/.test(after) ? Number(after) * 1000 : 2 ** attempt * 1000
        await sleep(delay)
      }

      throw new LlmError(`${config.baseUrl}/chat/completions failed — ${lastError}`)
    },
  }
}

function extractContent(body: unknown): string {
  const content = (body as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]
    ?.message?.content
  if (typeof content !== 'string') {
    throw new LlmError(`unexpected response shape: ${JSON.stringify(body).slice(0, 400)}`)
  }
  if (!content) throw new LlmError('the model returned an empty completion')
  return content
}
