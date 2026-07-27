import type { Env } from './types';

class GroqHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly retryable: boolean
  ) {
    super(`Groq request failed (${status})`);
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 ||
    status === 429 || status >= 500;
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
      if (total > maxBytes) throw new Error('Groq response exceeded the allowed size');
      output += decoder.decode(value, { stream: true });
    }
    output += decoder.decode();
    return output;
  } finally {
    reader.releaseLock();
  }
}

function decodeBase64(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return buffer;
}

export async function transcribeWithGroq(
  env: Env,
  audio: { base64: string; mimeType: string }
): Promise<string> {
  if (!env.GROQ_API_KEY) throw new Error('Groq API key not configured');
  const baseUrl = (env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1')
    .replace(/\/+$/, '');
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const form = new FormData();
      const extension = audio.mimeType.includes('webm')
        ? 'webm'
        : audio.mimeType.includes('ogg')
          ? 'ogg'
          : audio.mimeType.includes('wav')
            ? 'wav'
            : 'mp4';
      form.append(
        'file',
        new Blob([decodeBase64(audio.base64)], { type: audio.mimeType }),
        `voice.${extension}`
      );
      form.append('model', env.GROQ_SPEECH_MODEL || 'whisper-large-v3-turbo');
      form.append('response_format', 'json');
      form.append('temperature', '0');
      form.append(
        'prompt',
        'Employee work shift in German, Persian, English, or mixed language. Preserve names and 24-hour times.'
      );

      const response = await fetch(`${baseUrl}/audio/transcriptions`, {
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
        headers: {
          Authorization: `Bearer ${env.GROQ_API_KEY}`
        },
        body: form
      });
      if (!response.ok) {
        await readBodyLimited(response, 8 * 1024).catch(() => '');
        throw new GroqHttpError(
          response.status,
          isRetryableStatus(response.status)
        );
      }

      const body = await readBodyLimited(response, 256 * 1024);
      let payload: unknown;
      try {
        payload = JSON.parse(body);
      } catch {
        throw new Error('Groq returned invalid response JSON');
      }
      const text = payload && typeof payload === 'object' && 'text' in payload
        ? String(payload.text || '').trim()
        : '';
      if (!text) throw new Error('Groq returned an empty transcript');
      return text;
    } catch (error) {
      lastError = error;
      const retryable = error instanceof GroqHttpError && error.retryable;
      console.warn(JSON.stringify({
        event: 'groq_transcription_attempt_failed',
        attempt,
        retryable,
        status: error instanceof GroqHttpError ? error.status : undefined,
        message: error instanceof Error ? error.message.slice(0, 160) : 'unknown'
      }));
      if (!retryable || attempt === 2) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Groq transcription failed');
}
