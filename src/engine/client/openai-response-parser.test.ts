import { describe, test, expect } from 'bun:test';
import { SseResponseParser, JsonResponseParser } from './openai-response-parser';

function makeReader(chunks: string[]): { read(): Promise<{ done: boolean; value?: Uint8Array }> } {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    read: () => {
      if (i >= chunks.length) return Promise.resolve({ done: true });
      return Promise.resolve({ done: false, value: encoder.encode(chunks[i++]) });
    },
  };
}

describe('JsonResponseParser - parseJsonResponse', () => {
  const parser = new JsonResponseParser();

  test('extracts content from a valid response', () => {
    const result = parser.parseJsonResponse({
      choices: [{ message: { content: 'hello', tool_calls: undefined } }],
    });
    expect(result.content).toBe('hello');
    expect(result.toolCalls).toBeUndefined();
  });

  test('extracts tool_calls when present', () => {
    const toolCalls = [{ id: 'call_1', type: 'function' as const, function: { name: 'get_weather', arguments: '{}' } }];
    const result = parser.parseJsonResponse({
      choices: [{ message: { content: '', tool_calls: toolCalls } }],
    });
    expect(result.toolCalls).toEqual(toolCalls);
  });

  test('returns empty content when choices is missing', () => {
    const result = parser.parseJsonResponse({});
    expect(result.content).toBe('');
    expect(result.toolCalls).toBeUndefined();
  });

  test('returns empty content when message is missing', () => {
    const result = parser.parseJsonResponse({ choices: [{}] });
    expect(result.content).toBe('');
  });
});

describe('SseResponseParser - readSseStream', () => {
  const parser = new SseResponseParser(10000, 5000);

  function sseChunk(content: string): string {
    return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
  }

  test('concatenates content from multiple chunks', async () => {
    const reader = makeReader([sseChunk('Hello'), sseChunk(' world'), 'data: [DONE]\n\n']);
    const { content } = await parser.readSseStream(reader, Date.now());
    expect(content).toBe('Hello world');
  });

  test('ignores [DONE] sentinel', async () => {
    const reader = makeReader([sseChunk('ok'), 'data: [DONE]\n\n']);
    const { content } = await parser.readSseStream(reader, Date.now());
    expect(content).toBe('ok');
  });

  test('ignores malformed SSE lines', async () => {
    const reader = makeReader(['not-sse-data\n', sseChunk('valid'), 'data: [DONE]\n\n']);
    const { content } = await parser.readSseStream(reader, Date.now());
    expect(content).toBe('valid');
  });

  test('ignores lines with invalid JSON', async () => {
    const reader = makeReader(['data: {broken json}\n\n', sseChunk('ok'), 'data: [DONE]\n\n']);
    const { content } = await parser.readSseStream(reader, Date.now());
    expect(content).toBe('ok');
  });

  test('calls onFirstChunk on first chunk', async () => {
    let called = false;
    const reader = makeReader([sseChunk('x'), 'data: [DONE]\n\n']);
    await parser.readSseStream(reader, Date.now(), () => { called = true; });
    expect(called).toBe(true);
  });

  test('returns ttftMs > 0 when chunks arrive', async () => {
    const reader = makeReader([sseChunk('x'), 'data: [DONE]\n\n']);
    const { ttftMs } = await parser.readSseStream(reader, Date.now() - 50);
    expect(ttftMs).toBeGreaterThan(0);
  });

  test('returns empty content on empty stream', async () => {
    const reader = makeReader([]);
    const { content } = await parser.readSseStream(reader, Date.now());
    expect(content).toBe('');
  });
});
