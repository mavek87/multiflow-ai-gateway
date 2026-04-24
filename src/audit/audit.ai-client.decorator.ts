import {logAudit} from './audit.log';
import type {
    AIChatMessage,
    AIChatResponse,
    AIChatStreamResponse,
    AIClient,
} from '@/engine/client/client.types';
import type {
    ToolContext,
    ToolDefinition,
    ToolDispatcher
} from '@/engine/tools/tools.types';

export class AuditedAIClient implements AIClient {
    constructor(private readonly innerClient: AIClient) {
    }

    public async chat(systemPrompt: string, messages: AIChatMessage[], ctx?: ToolContext, tools?: ToolDefinition[], dispatcher?: ToolDispatcher): Promise<AIChatResponse> {
        return this.executeWithAudit(ctx?.tenantId ?? 'unknown', () => this.innerClient.chat(systemPrompt, messages, ctx, tools, dispatcher));
    }

    public async chatStream(systemPrompt: string, messages: AIChatMessage[], ctx?: ToolContext, tools?: ToolDefinition[], dispatcher?: ToolDispatcher): Promise<AIChatStreamResponse | null> {
        return this.executeWithAudit(ctx?.tenantId ?? 'unknown', () => this.innerClient.chatStream(systemPrompt, messages, ctx, tools, dispatcher));
    }

    public setTools(tools: ToolDefinition[], dispatcher: ToolDispatcher): void {
        if (this.innerClient.setTools) {
            this.innerClient.setTools(tools, dispatcher);
        }
    }

    public getTools(): ToolDefinition[] | undefined {
        return this.innerClient.getTools ? this.innerClient.getTools() : undefined;
    }

    private async executeWithAudit<T>(tenantId: string, operation: () => Promise<T>): Promise<T> {
        const startedAt = Date.now();
        try {
            const result = await operation();
            const latencyMs = Date.now() - startedAt;

            const model = (result as any)?.model || 'unknown';
            const aiProvider = (result as any)?.aiProvider || 'unknown';
            const isFailure = result === null || model === 'unknown';

            logAudit({
                tenantId,
                latencyMs,
                success: !isFailure,
                statusCode: isFailure ? 503 : 200,
                model,
                aiProvider
            });

            return result;
        } catch (error) {
            logAudit({
                tenantId,
                latencyMs: Date.now() - startedAt,
                success: false,
                statusCode: 500,
                model: 'unknown',
                aiProvider: 'unknown'
            });
            throw error;
        }
    }
}
