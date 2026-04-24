import type { AIChatMessage, ToolCall } from '@/chat/chat.types';
import type { ToolContext, ToolDefinition, ToolDispatcher } from '@/engine/tools/tools.types';

export type { AIChatMessage, ToolCall };

export interface AIBaseResponse {
  model: string;
  aiProvider: string;
  aiProviderUrl: string;
}

export interface AIChatResponse extends AIBaseResponse {
  content: string;
}

export interface AIChatStreamResponse extends AIBaseResponse {
  body: ReadableStream<Uint8Array>;
}

export type ModelConfig = {
  url: string;
  model: string;
  apiKey?: string;
  priority?: number;
  aiProviderId?: string;
  aiProviderName?: string;
  aiProviderBaseUrl?: string;
  aiProviderModelId?: string;
};

export interface AIClient {
  chat(
    systemPrompt: string,
    messages: AIChatMessage[],
    ctx?: ToolContext,
    tools?: ToolDefinition[],
    dispatcher?: ToolDispatcher,
  ): Promise<AIChatResponse>;
  chatStream(
    systemPrompt: string,
    messages: AIChatMessage[],
    ctx?: ToolContext,
    tools?: ToolDefinition[],
    dispatcher?: ToolDispatcher,
  ): Promise<AIChatStreamResponse | null>;
  setTools?(tools: ToolDefinition[], dispatcher: ToolDispatcher): void;
  getTools?(): ToolDefinition[] | undefined;
}
