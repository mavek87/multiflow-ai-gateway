export function buildProviderUrl(baseUrl: string, type: string): string {
    switch (type) {
        default:
            return `${baseUrl}/chat/completions`;
    }
}