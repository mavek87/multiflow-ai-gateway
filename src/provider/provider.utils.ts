export function buildProviderUrl(baseUrl: string, type: string): string {
    const base = baseUrl.replace(/\/+$/, '');
    switch (type) {
        default:
            return `${base}/chat/completions`;
    }
}
