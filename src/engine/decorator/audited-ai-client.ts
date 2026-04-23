import { logAudit } from '@/utils/audit-log';
import type { AIClient, AIChatMessage, AIChatResponse, AIChatStreamResponse, ToolContext, ToolDefinition, ToolDispatcher } from '@/engine/types';

export class AuditedAIClient implements AIClient {
    constructor(private readonly innerClient: AIClient) {}

    public async chat(messages: AIChatMessage[], ctx?: ToolContext, tools?: ToolDefinition[], dispatcher?: ToolDispatcher): Promise<AIChatResponse> {
        return this.executeWithAudit(ctx?.tenantId ?? 'unknown', () => this.innerClient.chat(messages, ctx, tools, dispatcher));
    }

    public async callStream(messages: AIChatMessage[], ctx?: ToolContext, tools?: ToolDefinition[], dispatcher?: ToolDispatcher): Promise<AIChatStreamResponse | null> {
        if (!this.innerClient.callStream) {
            throw new Error('Streaming not supported by this client');
        }
        return this.executeWithAudit(ctx?.tenantId ?? 'unknown', () => this.innerClient.callStream!(messages, ctx, tools, dispatcher));
    }

    public async *chatStream(messages: AIChatMessage[], ctx?: ToolContext, tools?: ToolDefinition[], dispatcher?: ToolDispatcher): AsyncGenerator<string> {
        if (!this.innerClient.chatStream) {
            throw new Error('Streaming not supported by this client');
        }
        yield* this.innerClient.chatStream(messages, ctx, tools, dispatcher);
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
            
            // if operation is callStream and it returns null, that means all models failed
            if (result === null) {
                const latencyMs = Date.now() - startedAt;
                logAudit({ tenantId, aiProvider: 'unknown', model: 'unknown', latencyMs, success: false, statusCode: 503 });
                return result;
            }

            const model = (result as any)?.model || 'unknown';
            const aiProvider = (result as any)?.aiProvider || 'unknown';
            const latencyMs = Date.now() - startedAt;

            logAudit({ tenantId, aiProvider, model, latencyMs, success: true, statusCode: 200 });
            return result;
            
        } catch (error) {
            const latencyMs = Date.now() - startedAt;
            logAudit({ tenantId, aiProvider: 'unknown', model: 'unknown', latencyMs, success: false, statusCode: 500 });
            throw error; 
        }
    }
}
