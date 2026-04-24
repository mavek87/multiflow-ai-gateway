/**
 * Envelope encryption for provider API keys at rest.
 * Uses AES-256-GCM: authenticated encryption, tamper-evident.
 *
 * Stored format: base64(<12-byte IV> + <ciphertext> + <16-byte auth tag>)
 */

import {createCipheriv, createDecipheriv, randomBytes} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const HEX_ENCODING = 'hex'
const BASE_64_ENCODING = 'base64'
const UTF_8_ENCODING = 'utf8'

export class CryptoService {
    private readonly key: Buffer;

    constructor(encryptionKey?: string) {
        const hex = encryptionKey || process.env['ENCRYPTION_KEY'];
        if (!hex || hex.length !== 64) {
            throw new Error('ENCRYPTION_KEY must be a 64-char hex string (32 bytes)');
        }
        this.key = Buffer.from(hex, HEX_ENCODING);
    }

    public encrypt(plaintext: string): string {
        // Fresh random IV per call: same plaintext → different ciphertext each time.
        const ivBuf = randomBytes(IV_LENGTH);
        const cipher = createCipheriv(ALGORITHM, this.key, ivBuf);
        const encrypted = Buffer.concat([cipher.update(plaintext, UTF_8_ENCODING), cipher.final()]);
        const tag = cipher.getAuthTag();
        // Layout stored in DB: base64( IV[12] + ciphertext[n] + authTag[16] )
        // The auth tag makes tampering detectable - decrypt() throws if data was modified.
        return Buffer.concat([ivBuf, encrypted, tag]).toString(BASE_64_ENCODING);
    }

    public decrypt(encoded: string): string {
        const buf = Buffer.from(encoded, BASE_64_ENCODING);
        if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH) {
            throw new Error('Decryption failed: payload is too short to be valid.');
        }
        const iv = buf.subarray(0, IV_LENGTH);
        const tag = buf.subarray(buf.length - AUTH_TAG_LENGTH);
        const ciphertext = buf.subarray(IV_LENGTH, buf.length - AUTH_TAG_LENGTH);
        const decipher = createDecipheriv(ALGORITHM, this.key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(UTF_8_ENCODING);
    }
}
