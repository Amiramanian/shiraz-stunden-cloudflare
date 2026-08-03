import type { Env } from './types';

export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

class GeminiHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly retryable: boolean,
    detail = ''
  ) {
    super(`Gemini request failed (${status})${detail ? `: ${detail}` : ''}`);
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 ||
    status >= 500;
}

async function readBodyLimited(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let output = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new Error('Gemini response exceeded the allowed size');
      }
      output += decoder.decode(value, { stream: true });
    }
    output += decoder.decode();
    return output;
  } finally {
    reader.releaseLock();
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
}

function extractResponseText(payload: unknown): string {
  const candidates = asRecord(payload).candidates;
  const firstCandidate = Array.isArray(candidates) ? asRecord(candidates[0]) : {};
  const content = asRecord(firstCandidate.content);
  const parts = Array.isArray(content.parts) ? content.parts : [];
  return parts
    .map((part) => String(asRecord(part).text || ''))
    .join('')
    .trim();
}

function parseJsonText(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('Gemini returned no JSON object');
  }
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new Error('Gemini returned invalid JSON');
  }
}

export function dataUrlToGeminiPart(dataUrl: string): GeminiPart {
  const match = dataUrl.match(
    /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i
  );
  if (!match) throw new Error('Invalid media data URL');
  return {
    inlineData: {
      mimeType: match[1].toLowerCase(),
      data: match[2].replace(/\s+/g, '')
    }
  };
}

export async function generateGeminiJson(
  env: Env,
  input: {
    systemPrompt: string;
    parts: GeminiPart[];
    schema: unknown;
    maxOutputTokens?: number;
    timeoutMs?: number;
  }
): Promise<unknown> {
  if (!env.GEMINI_API_KEY) {
    throw new Error('Gemini API key not configured');
  }

  const baseUrl = (env.GEMINI_BASE_URL ||
    'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
  const model = env.GEMINI_MODEL || 'gemini-flash-latest';
  const endpoint = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`;
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        signal: AbortSignal.timeout(input.timeoutMs || 45_000),
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: input.systemPrompt }]
          },
          contents: [{
            role: 'user',
            parts: input.parts
          }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: input.maxOutputTokens || 8192,
            responseMimeType: 'application/json',
            responseJsonSchema: input.schema
          }
        })
      });

      if (!response.ok) {
        const errorBody = await readBodyLimited(response, 8 * 1024).catch(() => '');
        let detail = '';
        try {
          const parsed = JSON.parse(errorBody) as {
            error?: { message?: unknown };
          };
          detail = String(parsed.error?.message || '').replace(/\s+/g, ' ').slice(0, 240);
        } catch {
          detail = '';
        }
        throw new GeminiHttpError(
          response.status,
          isRetryableStatus(response.status),
          detail
        );
      }

      const responseText = await readBodyLimited(response, 2 * 1024 * 1024);
      let payload: unknown;
      try {
        payload = JSON.parse(responseText);
      } catch {
        throw new Error('Gemini returned invalid response JSON');
      }

      const content = extractResponseText(payload);
      if (!content) throw new Error('Gemini returned an empty response');
      return parseJsonText(content);
    } catch (error) {
      lastError = error;
      const retryable = error instanceof GeminiHttpError && error.retryable;
      console.warn(JSON.stringify({
        event: 'gemini_attempt_failed',
        attempt,
        retryable,
        status: error instanceof GeminiHttpError ? error.status : undefined,
        message: error instanceof Error ? error.message.slice(0, 160) : 'unknown'
      }));
      if (!retryable || attempt === 2) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Gemini request failed');
}
