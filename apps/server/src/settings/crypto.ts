import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * API Key 落库加密:AES-256-GCM,密钥由服务端 JWT_SECRET 派生(scrypt)。
 * 格式:iv.authTag.ciphertext(均 base64)。换 JWT_SECRET 会导致已存 Key 无法解密,
 * 用户重填即可——不做多密钥轮转,保持简单。
 */

const SALT = 'testpilot-model-key-v1';

function deriveKey(secret: string): Buffer {
  return scryptSync(secret, SALT, 32);
}

export function encryptSecret(plaintext: string, serverSecret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(serverSecret), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((b) => b.toString('base64')).join('.');
}

export function decryptSecret(payload: string, serverSecret: string): string {
  const [ivB64, tagB64, dataB64] = payload.split('.');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('密文格式不合法');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    deriveKey(serverSecret),
    Buffer.from(ivB64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** 展示用掩码:sk-****last4 */
export function maskSecret(plaintext: string): string {
  if (plaintext.length <= 4) return '****';
  return `${plaintext.slice(0, 3)}****${plaintext.slice(-4)}`;
}
