import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * 规整用户输入/拖拽产生的路径:去包裹引号、反转义空格、展开 ~。
 * (从访达拖文件到终端会得到形如 /a\ b/c.pdf 或 '/a b/c.pdf' 的路径)
 */
export function normalizeDropPath(input: string): string {
  let p = input.trim();
  if ((p.startsWith("'") && p.endsWith("'")) || (p.startsWith('"') && p.endsWith('"'))) {
    p = p.slice(1, -1);
  }
  p = p.replace(/\\(.)/g, '$1'); // \ 转义还原(空格等)
  if (p === '~' || p.startsWith('~/')) p = path.join(homedir(), p.slice(1));
  return p;
}

/**
 * 读需求文档正文,按扩展名解析:
 * .md/.txt/其它文本 直接读;.pdf 走 pdf 解析;.docx 走 mammoth;.doc 提示转格式。
 */
export async function readDoc(filePath: string): Promise<string> {
  const p = normalizeDropPath(filePath);
  const ext = path.extname(p).toLowerCase();

  if (ext === '.pdf') {
    const mod = (await import('pdf-parse-new')) as unknown as {
      default: (buf: Buffer) => Promise<{ text: string }>;
    };
    const data = await mod.default(await readFile(p));
    return data.text.trim();
  }
  if (ext === '.docx') {
    const mammoth = (await import('mammoth')) as unknown as {
      extractRawText: (o: { path: string }) => Promise<{ value: string }>;
    };
    const { value } = await mammoth.extractRawText({ path: p });
    return value.trim();
  }
  if (ext === '.doc') {
    throw new Error('旧版 .doc 暂不支持,请在 Word 里另存为 .docx 或导出 PDF 后再导入');
  }
  // md / txt / 无扩展名 → 当纯文本
  return (await readFile(p, 'utf8')).trim();
}
