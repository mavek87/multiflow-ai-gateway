import type { AIChatMessage, ToolCall } from '@/chat/chat.types';
import type { ToolContext, ToolDefinition, ToolDispatcher } from '@/engine/tools/tools.types';

export type { AIChatMessage, ToolCall };

export interface AIBaseResponse {
  model: string;
  aiProviderId: string;
  aiProvider: string;
  aiProviderUrl: string;
}

export interface AIChatResponse extends AIBaseResponse {
  content: string;
  toolCalls?: ToolCall[];
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

export interface ChatOptions {
  tools?: unknown[];
  tool_choice?: unknown;
  parallel_tool_calls?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  seed?: number;
  stop?: string | string[];
  response_format?: unknown;
  stream_options?: unknown;
  user?: string;
}
