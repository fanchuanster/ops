/**
 * Chat completions against an OpenAI-compatible endpoint.
 *
 * Ported from `services/converter/app/llm/client.py` on 2026-08-26. The
 * provider abstraction survived the move because it is the thing that
 * made the move cheap: the pipeline has never known which endpoint is
 * answering, so relocating it from a container to a Worker changed the
 * transport (httpx → fetch) and nothing else.
 *
 * CLAUDE.md section 4: endpoint, model and key are configuration and are
 * never hard-coded. On a Worker they arrive on the `env` object rather
 * than in `process.env`, which is the only real difference.
 */

/** A single-turn chat completion. Deliberately the whole interface. */
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

/**
 * Only the base URL and model differ; a provider is not a code path,
 * which is the point.
 */
const PROVIDERS: Record<string, ProviderSpec> = {
  xai: {
    baseUrl: 'https://api.x.ai/v1',
    // The cheap text model, chosen deliberately. Correction is a narrow,
    // well-specified task over short inputs, and the non-reasoning
    // variant spends no reasoning tokens — which are billed as output at
    // twice the input rate and are the real cost of running a whole book
    // through this stage.
    model: 'grok-4.20-0309-non-reasoning',
    keyVar: 'XAI_API_KEY',
    keyRequired: true,
  },
  vllm: {
    // No default endpoint: the internal address is deployment
    // configuration, and hard-coding it is exactly what section 4
    // forbids.
    baseUrl: '',
    model: 'google/gemma-4-31B-it-qat-w4a16-ct',
    keyVar: 'VLLM_API_KEY',
    // A self-hosted vLLM is usually served without authentication.
    keyRequired: false,
  },
}

/**
 * Retried rather than failed: a book is hundreds of requests and a
 * single transient rate-limit should not throw away the work already
 * done.
 */
const RETRY_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504])

export interface LlmConfig {
  provider: string
  baseUrl: string
  model: string
  apiKey: string
  timeoutMs: number
  maxRetries: number
  /**
   * Ask the endpoint to constrain output to JSON. xAI supports it; a
   * given vLLM build may not, and the parser copes either way.
   */
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

  // LLM_* overrides the provider's own variables, so a deployment can
  // point the pipeline anywhere OpenAI-compatible without this file
  // growing a third provider.
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

/** True when the key needed to talk to the provider is present. */
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
        // Deterministic: the same page should not produce different
        // suggestions on a re-run, or a reviewer cannot trust a diff.
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
          // A timeout or a dropped connection is exactly the transient
          // failure the retry loop exists for.
          lastError = (error as Error).message
          if (attempt === config.maxRetries - 1) break
          await sleep(2 ** attempt * 1000)
          continue
        }

        if (response.ok) return extractContent(await response.json())

        lastError = `HTTP ${response.status}: ${(await response.text()).slice(0, 400)}`
        if (!RETRY_STATUSES.has(response.status)) break

        // Honour Retry-After when the server sends one; otherwise back
        // off exponentially from one second.
        const after = response.headers.get('Retry-After')
        const delay = after && /^\d+$/.test(after) ? Number(after) * 1000 : 2 ** attempt * 1000
        await sleep(delay)
      }

      throw new LlmError(`${config.baseUrl}/chat/completions failed — ${lastError}`)
    },
  }
}

/**
 * Pull the assistant text out of an OpenAI-shaped response.
 *
 * Only `content` is read. Reasoning models also return
 * `reasoning_content`, which is the model's scratch work and must never
 * be parsed as the answer.
 */
function extractContent(body: unknown): string {
  const content = (body as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]
    ?.message?.content
  if (typeof content !== 'string') {
    throw new LlmError(`unexpected response shape: ${JSON.stringify(body).slice(0, 400)}`)
  }
  if (!content) throw new LlmError('the model returned an empty completion')
  return content
}
