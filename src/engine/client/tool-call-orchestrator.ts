import type { AIChatMessage, ToolCall, ToolDefinition } from '@/engine/types';
import type { CallResult } from './http-provider-client';
import { createLogger } from '@/utils/logger';
import { stripThinkTags } from '@/utils/text';

const log = createLogger('TOOL-ORCHESTRATOR');

export type ModelCallFn = (messages: AIChatMessage[]) => Promise<CallResult>;

type ModelResponse = { ok: true; content: string; toolCalls?: ToolCall[]; ttftMs: number; latencyMs: number };

export class ToolCallOrchestrator {
  constructor(
    private readonly callModel: ModelCallFn,
    private readonly maxModelCalls = 10,
  ) {}

  async applyTools(
    history: AIChatMessage[],
    tools: ToolDefinition[],
    executeTool: (name: string, args: Record<string, unknown>) => Promise<string>,
    onFirstToolCall?: () => Promise<void>,
  ): Promise<CallResult> {
    if (!history.length) return { ok: false, kind: 'hard', error: new Error('history must not be empty') };
    if (!history.some(m => m.role === 'user')) return { ok: false, kind: 'hard', error: new Error('history must contain at least one user message') };
    if (!tools.length) return { ok: false, kind: 'hard', error: new Error('tools must not be empty') };

    const conversationHistory = [...history];
    let ackSent = false;

    for (let callNumber = 0; callNumber < this.maxModelCalls; callNumber++) {
      const result = await this.callModel(conversationHistory);
      if (!result.ok) return result;

      const { content, toolCalls, ttftMs, latencyMs } = result as ModelResponse;
      history.push({ role: 'assistant', content, ...(toolCalls ? { tool_calls: toolCalls } : {}) });

      const hasToolCalls = toolCalls != null && toolCalls.length > 0;
      if (!hasToolCalls) return this.buildTextResult(content, ttftMs, latencyMs, ackSent, conversationHistory);

      ackSent = await this.notifyFirstToolCall(ackSent, onFirstToolCall);
      await this.executeToolCallsAndAppendResults(toolCalls, conversationHistory, executeTool);
    }

    const finalContent = conversationHistory.findLast(m => m.role === 'assistant')?.content ?? '';
    return { ok: true, content: stripThinkTags(finalContent) || '✅', ttftMs: 0, latencyMs: 0 };
  }

  private buildTextResult(content: string, ttftMs: number, latencyMs: number, ackSent: boolean, history: AIChatMessage[]): CallResult {
    const text = stripThinkTags(content);
    if (text) return { ok: true, content: text, ttftMs, latencyMs };
    if (ackSent) return { ok: true, content: this.lastAssistantText(history), ttftMs, latencyMs };
    return { ok: false, kind: 'hard', error: new Error('empty response') };
  }

  private async notifyFirstToolCall(ackSent: boolean, onFirstToolCall?: () => Promise<void>): Promise<boolean> {
    if (!ackSent && onFirstToolCall) await onFirstToolCall();
    return true;
  }

  private async executeToolCallsAndAppendResults(
    toolCalls: ToolCall[],
    history: AIChatMessage[],
    executeTool: (name: string, args: Record<string, unknown>) => Promise<string>,
  ): Promise<void> {
    log.debug({ count: toolCalls.length }, 'executing tool calls');
    for (const toolCall of toolCalls) {
      const toolResult = await executeTool(toolCall.function.name, toolCall.function.arguments);
      log.debug({ tool: toolCall.function.name }, 'tool executed');
      history.push({ role: 'tool', content: toolResult, tool_call_id: toolCall.id });
    }
  }

  private lastAssistantText(conversationHistory: AIChatMessage[]): string {
    const last = conversationHistory.filter(m => m.role === 'assistant' && !m.tool_calls && m.content.trim()).at(-1)?.content ?? '';
    return stripThinkTags(last) || '✅';
  }
}
