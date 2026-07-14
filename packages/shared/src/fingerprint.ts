/**
 * 缺陷指纹:同一类问题在不同时间/不同数据下应得到相同指纹,用于去重合并。
 * 归一化规则:剔除易变部分(数字、UUID、十六进制串、时间戳、query 参数)。
 */

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const HEX_RE = /\b[0-9a-f]{16,}\b/gi;
const NUM_RE = /\d+/g;

export function normalizeForFingerprint(text: string): string {
  return text
    .replace(UUID_RE, '<uuid>')
    .replace(HEX_RE, '<hex>')
    .replace(NUM_RE, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** URL 归一化:去掉 query/hash,路径中的纯数字段与 UUID 段替换为占位符 */
export function normalizeUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const path = u.pathname
      .split('/')
      .map((seg) => {
        if (/^\d+$/.test(seg)) return '<n>';
        if (UUID_RE.test(seg)) return '<uuid>';
        return seg;
      })
      .join('/');
    return `${u.origin}${path}`;
  } catch {
    return normalizeForFingerprint(rawUrl);
  }
}

/** FNV-1a,足够做指纹,无需引入加密依赖 */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function makeFingerprint(detector: string, ...parts: string[]): string {
  const normalized = parts.map(normalizeForFingerprint).join('|');
  return `${detector}:${fnv1a(normalized)}`;
}
