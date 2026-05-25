import { API_TOKEN } from './api';

export interface SseStreamResult {
  text: string;
  usageId: string | null;
}

/**
 * POST to an SSE endpoint and yield text deltas as they arrive. Splits the
 * `data:` frames, decodes our `\n` escape, and pulls a trailing
 * `{"_meta":{"usage_id":"…"}}` frame so the caller can attach 👍/👎 feedback
 * to the AI call once it's finished.
 *
 * Generator yields the running concatenated text after each new delta;
 * returns the final {text, usageId} pair.
 */
export async function* streamAi(
  url: string,
  body: any,
): AsyncGenerator<string, SseStreamResult, void> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'X-API-Token': API_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok || !resp.body) {
    throw new Error(`AI stream failed: HTTP ${resp.status}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let usageId: string | null = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6);
      if (payload === '[DONE]') return { text, usageId };
      // _meta frames carry the usage_id for feedback attachment.
      if (payload.startsWith('{') && payload.includes('"_meta"')) {
        try {
          const parsed = JSON.parse(payload);
          if (parsed?._meta?.usage_id) usageId = parsed._meta.usage_id;
        } catch {
          // not valid JSON — fall through and treat as text
        }
        continue;
      }
      // Regular content frame — decode our `\n` escape (the backend replaces
      // raw newlines with the two-char `\n` sequence to keep SSE valid).
      const decoded = payload.replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
      text += decoded;
      yield text;
    }
  }
  return { text, usageId };
}
