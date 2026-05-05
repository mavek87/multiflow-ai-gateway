import type { ProviderBaseResponse } from '@/engine/client/http-provider-client.types';

export type RoutedSuccess<T> = T & ProviderBaseResponse & { model: string };
