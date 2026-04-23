import { describe, test, expect } from 'bun:test';
import { ok, err } from 'neverthrow';
import { ToolCallOrchestrator } from './tool-call-orchestrator';
import type { CallProviderResult } from './http-provider-client';
import type { AIChatMessage, ToolDefinition } from '@/engine/engine.types';

const HISTORY: AIChatMessage[] = [
  { role: 'system', content: 'you are a helpful assistant' },
  { role: 'user', content: 'hello' },
];

const TOOL_DEF: ToolDefinition = {
  type: 'function',
  function: {
    name: 'get_weather',
    description: 'Returns weather',
    parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
  },
};

function okResult(content: string): CallProviderResult {
  return ok({ content, ttftMs: 1, latencyMs: 5 });
}

function toolCallResult(name: string, args: Record<string, unknown> = {}): CallProviderResult {
  return ok({
    content: '',
    toolCalls: [{ id: `tc-${name}`, type: 'function', function: { name, arguments: args } }],
    ttftMs: 1,
    latencyMs: 5,
  });
}

function hardError(): CallProviderResult {
  return err({ kind: 'hard', error: new Error('upstream failure') });
}

describe('ToolCallOrchestrator — input validation', () => {
  const noop = async () => '';

  test('returns hard error when history is empty', async () => {
    const orchestrator = new ToolCallOrchestrator(async () => okResult('ok'));
    const result = await orchestrator.applyTools([], [TOOL_DEF], noop);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe('hard');
  });

  test('returns hard error when history has no user message', async () => {
    const orchestrator = new ToolCallOrchestrator(async () => okResult('ok'));
    const historyWithoutUser: AIChatMessage[] = [{ role: 'system', content: 'system prompt' }];
    const result = await orchestrator.applyTools(historyWithoutUser, [TOOL_DEF], noop);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe('hard');
  });

  test('returns hard error when tools list is empty', async () => {
    const orchestrator = new ToolCallOrchestrator(async () => okResult('ok'));
    const result = await orchestrator.applyTools(HISTORY, [], noop);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe('hard');
  });
});

describe('ToolCallOrchestrator', () => {
  test('executes a tool call and feeds result back, then returns final answer', async () => {
    let call = 0;
    const orchestrator = new ToolCallOrchestrator(async () => {
      call++;
      if (call === 1) return toolCallResult('get_weather', { city: 'Rome' });
      return okResult('It is sunny in Rome');
    });

    let toolCallCount = 0;
    const result = await orchestrator.applyTools(HISTORY, [TOOL_DEF], async (name, args) => {
      toolCallCount++;
      expect(name).toBe('get_weather');
      expect(args).toEqual({ city: 'Rome' });
      return 'Sunny, 28C';
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value.content).toBe('It is sunny in Rome');
    expect(toolCallCount).toBe(1);
  });

  test('strips <think> tags from final response', async () => {
    const orchestrator = new ToolCallOrchestrator(async () => okResult('<think>reasoning</think>actual answer'));
    const result = await orchestrator.applyTools(HISTORY, [TOOL_DEF], async () => '');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value.content).toBe('actual answer');
  });

  test('returns hard error when content is empty and no tool calls ran', async () => {
    const orchestrator = new ToolCallOrchestrator(async () => okResult(''));
    const result = await orchestrator.applyTools(HISTORY, [TOOL_DEF], async () => '');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe('hard');
  });

  test('propagates hard failure from fetchCompletion', async () => {
    const orchestrator = new ToolCallOrchestrator(async () => hardError());
    const result = await orchestrator.applyTools(HISTORY, [TOOL_DEF], async () => '');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe('hard');
  });

  test('executes multiple sequential tool-calls', async () => {
    const callSequence: string[] = [];
    let call = 0;
    const orchestrator = new ToolCallOrchestrator(async () => {
      call++;
      if (call === 1) return toolCallResult('tool_a');
      if (call === 2) return toolCallResult('tool_b');
      return okResult('done');
    });

    const result = await orchestrator.applyTools(HISTORY, [TOOL_DEF], async (name) => {
      callSequence.push(name);
      return 'result';
    });

    expect(result.isOk()).toBe(true);
    expect(callSequence).toEqual(['tool_a', 'tool_b']);
  });

  test('appends tool result messages to history passed to subsequent calls', async () => {
    const histories: AIChatMessage[][] = [];
    let call = 0;
    const orchestrator = new ToolCallOrchestrator(async (msgs) => {
      histories.push([...msgs]);
      call++;
      if (call === 1) return toolCallResult('get_weather', { city: 'Milan' });
      return okResult('Cloudy');
    });

    await orchestrator.applyTools(HISTORY, [TOOL_DEF], async () => 'Cloudy, 18C');

    const secondCallHistory = histories[1]!;
    const assistantMsg = secondCallHistory.find(m => m.role === 'assistant');
    const toolMsg = secondCallHistory.find(m => m.role === 'tool');
    expect(assistantMsg?.tool_calls?.[0]?.function.name).toBe('get_weather');
    expect(toolMsg?.content).toBe('Cloudy, 18C');
    expect(toolMsg?.tool_call_id).toBe('tc-get_weather');
  });

  test('calls onFirstToolCall exactly once on first tool call', async () => {
    let call = 0;
    const orchestrator = new ToolCallOrchestrator(async () => {
      call++;
      if (call <= 2) return toolCallResult('some_tool');
      return okResult('final answer');
    });

    let ackCount = 0;
    await orchestrator.applyTools(HISTORY, [TOOL_DEF], async () => 'result', async () => { ackCount++; });

    expect(ackCount).toBe(1);
  });

  test('does not call onFirstToolCall when no tool calls occur', async () => {
    const orchestrator = new ToolCallOrchestrator(async () => okResult('direct answer'));
    let ackCount = 0;
    await orchestrator.applyTools(HISTORY, [TOOL_DEF], async () => '', async () => { ackCount++; });
    expect(ackCount).toBe(0);
  });

  test('returns fallback content after tool calls when final call returns empty', async () => {
    let call = 0;
    const orchestrator = new ToolCallOrchestrator(async () => {
      call++;
      if (call === 1) return toolCallResult('get_weather');
      return okResult('');
    });

    const result = await orchestrator.applyTools(HISTORY, [TOOL_DEF], async () => 'weather data', async () => {});
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value.content.length).toBeGreaterThan(0);
  });

  test('caps at 10 calls and returns last assistant content', async () => {
    let calls = 0;
    const orchestrator = new ToolCallOrchestrator(async () => {
      calls++;
      return toolCallResult('infinite_tool');
    });

    const result = await orchestrator.applyTools(HISTORY, [TOOL_DEF], async () => 'loop');
    expect(result.isOk()).toBe(true);
    expect(calls).toBe(10);
  });

  test('propagates hard failure from fetchCompletion mid-loop', async () => {
    let call = 0;
    const orchestrator = new ToolCallOrchestrator(async () => {
      call++;
      if (call === 1) return toolCallResult('get_weather');
      return hardError();
    });

    const result = await orchestrator.applyTools(HISTORY, [TOOL_DEF], async () => 'data');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe('hard');
  });
});
