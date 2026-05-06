import type {ToolCall} from '@/chat/chat.types';

export interface TenantContext {
    tenantId: string;
    tenantName: string;
}

export interface ProviderBaseResponse {
    model: string;
    aiProviderId: string;
    aiProvider: string;
    aiProviderUrl: string;
}

export interface ProviderChatResponse extends ProviderBaseResponse {
    content: string;
    toolCalls?: ToolCall[];
    body?: Record<string, unknown>;
}

export interface ProviderStreamResponse extends ProviderBaseResponse {
    body: ReadableStream<Uint8Array>;
}

export type RoutedSuccess<T> = T & ProviderBaseResponse & { model: string };
