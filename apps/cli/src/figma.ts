import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/** 从 Figma 链接解析出 fileKey 与可选 nodeId */
export function parseFigmaUrl(input: string): { fileKey: string; nodeId?: string } {
  // 支持 https://www.figma.com/(file|design|proto)/<key>/<name>?node-id=1-2
  const keyMatch = input.match(/figma\.com\/(?:file|design|proto)\/([A-Za-z0-9]+)/);
  const fileKey = keyMatch?.[1] ?? (/^[A-Za-z0-9]+$/.test(input) ? input : undefined);
  if (!fileKey) throw new Error('无法解析 Figma 链接,请提供 figma.com/design/<key>/... 或 fileKey');
  const nodeMatch = input.match(/node-id=([0-9]+-[0-9]+|[0-9]+%3A[0-9]+|[0-9]+:[0-9]+)/);
  const nodeId = nodeMatch?.[1]?.replace('%3A', ':').replace('-', ':');
  return { fileKey, nodeId };
}

/**
 * 经 Figma MCP(Framelink figma-developer-mcp,stdio)拉取设计数据。
 * 需环境变量 FIGMA_API_KEY;返回精简后的设计文本(层级/文案/组件),交给 claude 生成用例。
 */
export async function fetchFigmaContext(
  urlOrKey: string,
  opts: { apiKey?: string; timeoutMs?: number } = {},
): Promise<string> {
  const apiKey = opts.apiKey ?? process.env.FIGMA_API_KEY;
  if (!apiKey) {
    throw new Error('缺少 Figma 凭证:请设置环境变量 FIGMA_API_KEY(Figma 个人访问令牌)');
  }
  const { fileKey, nodeId } = parseFigmaUrl(urlOrKey);

  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['-y', 'figma-developer-mcp', `--figma-api-key=${apiKey}`, '--stdio'],
  });
  const client = new Client({ name: 'testpilot', version: '0.2.0' }, { capabilities: {} });

  try {
    await client.connect(transport);
    const result = (await client.callTool({
      name: 'get_figma_data',
      arguments: nodeId ? { fileKey, nodeId } : { fileKey },
    })) as { content?: Array<{ type: string; text?: string }> };

    const text = (result.content ?? [])
      .filter((c) => c.type === 'text' && c.text)
      .map((c) => c.text)
      .join('\n')
      .trim();
    if (!text) throw new Error('Figma MCP 返回空数据,请确认 fileKey/node 与令牌权限');
    return text;
  } finally {
    await client.close().catch(() => {});
  }
}
