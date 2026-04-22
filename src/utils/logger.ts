import pino from 'pino';

const root = pino({ level: process.env.LOG_LEVEL ?? 'info' });

export const createLogger = (label: string) => root.child({ label });
