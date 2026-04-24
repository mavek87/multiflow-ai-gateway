import {err, ok} from 'neverthrow';
import type {AIChatMessage, ToolCall, ToolDefinition} from '@/engine/engine.types';
import type {CallProviderResult} from './http-provider-client';
import {stripThinkTags} from '@/utils/text';

export type ModelCallFn = (messages: AIChatMessage[]) => Promise<CallProviderResult>;

export class ToolCallOrchestrator {
    constructor(
        private readonly callModelFn: ModelCallFn,
        private readonly maxModelCalls = 10,
    ) {
    }

    async applyTools(history: AIChatMessage[],
                     tools: ToolDefinition[],
                     executeTool: (name: string, args: Record<string, unknown>) => Promise<string>,
                     onFirstToolCall?: () => Promise<void>): Promise<CallProviderResult> {
        if (!history.length) return err({kind: 'hard', error: new Error('history must not be empty')});
        if (!history.some(m => m.role === 'user')) return err({
            kind: 'hard',
            error: new Error('history must contain at least one user message')
        });
        if (!tools.length) return err({kind: 'hard', error: new Error('tools must not be empty')});

        const conversationHistory = [...history];
        let ackSent = false;
        let firstTtftMs = 0;
        let totalLatencyMs = 0;

        for (let callNumber = 0; callNumber < this.maxModelCalls; callNumber++) {
            const result = await this.callModelFn(conversationHistory);
            if (result.isErr()) return result;

            const {content, toolCalls, ttftMs, latencyMs} = result.value;
            if (callNumber === 0) firstTtftMs = ttftMs;
            totalLatencyMs += latencyMs;
            history.push({role: 'assistant', content, ...(toolCalls ? {tool_calls: toolCalls} : {})});

            const hasToolCalls = toolCalls != null && toolCalls.length > 0;
            if (!hasToolCalls) return this.buildTextResult(content, firstTtftMs, totalLatencyMs, ackSent, conversationHistory);

            ackSent = await this.notifyFirstToolCall(ackSent, onFirstToolCall);
            await this.executeToolCallsAndAppendResults(toolCalls, conversationHistory, executeTool);
        }

        const finalContent = conversationHistory.findLast(m => m.role === 'assistant')?.content ?? '';
        return ok({content: stripThinkTags(finalContent) || '✅', ttftMs: firstTtftMs, latencyMs: totalLatencyMs});
    }

    private buildTextResult(content: string, ttftMs: number, latencyMs: number, ackSent: boolean, history: AIChatMessage[]): CallProviderResult {
        const text = stripThinkTags(content);
        if (text) return ok({content: text, ttftMs, latencyMs});
        if (ackSent) return ok({content: this.lastAssistantText(history), ttftMs, latencyMs});
        return err({kind: 'hard', error: new Error('empty response')});
    }

    private async notifyFirstToolCall(ackSent: boolean, onFirstToolCall?: () => Promise<void>): Promise<boolean> {
        if (!ackSent && onFirstToolCall) await onFirstToolCall();
        return true;
    }

    private async executeToolCallsAndAppendResults(toolCalls: ToolCall[],
                                                   history: AIChatMessage[],
                                                   executeToolFn: (name: string, args: Record<string, unknown>) => Promise<string>): Promise<void> {
        for (const toolCall of toolCalls) {
            const toolResult = await executeToolFn(toolCall.function.name, toolCall.function.arguments);
            history.push({role: 'tool', content: toolResult, tool_call_id: toolCall.id});
        }
    }

    private lastAssistantText(conversationHistory: AIChatMessage[]): string {
        const last = conversationHistory.filter(m => m.role === 'assistant' && !m.tool_calls && m.content.trim()).at(-1)?.content ?? '';
        return stripThinkTags(last) || '✅';
    }
}
