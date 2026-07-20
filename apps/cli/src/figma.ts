import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/** 从 Figma 链接解析出 fileKey 与可选 nodeId */
export function parseFigmaUrl(input: string): { fileKey?: string; nodeId?: string } {
  const keyMatch = input.match(/figma\.com\/(?:file|design|proto)\/([A-Za-z0-9]+)/);
  const fileKey = keyMatch?.[1] ?? (/^[A-Za-z0-9]+$/.test(input) ? input : undefined);
  const nodeMatch = input.match(/node-id=([0-9]+-[0-9]+|[0-9]+%3A[0-9]+|[0-9]+:[0-9]+)/);
  const nodeId = nodeMatch?.[1]?.replace('%3A', ':').replace('-', ':');
  return { fileKey, nodeId };
}

interface McpTool {
  name: string;
  description?: string;
}

/**
 * 从工具清单里挑最能反映界面结构/文案的工具(不同 Figma MCP 版本工具名不同)。
 * 优先级:元数据/结构 > 代码(含文案) > 设计数据。
 */
export function pickDesignTool(tools: McpTool[]): string | null {
  const names = tools.map((t) => t.name);
  const prefer = [
    'get_metadata',
    'get_design_context',
    'get_figma_data',
    'get_code',
    'get_screen',
  ];
  for (const p of prefer) if (names.includes(p)) return p;
  // 兜底:名字里带 metadata/design/code 的第一个
  return names.find((n) => /metadata|design|code|figma/i.test(n)) ?? names[0] ?? null;
}

function extractText(result: { content?: Array<{ type: string; text?: string }> }): string {
  return (result.content ?? [])
    .filter((c) => c.type === 'text' && c.text)
    .map((c) => c.text)
    .join('\n')
    .trim();
}

async function callDesignTool(
  client: Client,
  nodeId: string | undefined,
): Promise<string> {
  const { tools } = (await client.listTools()) as { tools: McpTool[] };
  const toolName = pickDesignTool(tools);
  if (!toolName) throw new Error('Figma MCP 未暴露可用工具');
  // 带 nodeId 优先;失败(如工具只认当前选中)再无参重试
  const tryCall = async (args: Record<string, unknown>) =>
    extractText((await client.callTool({ name: toolName, arguments: args })) as never);
  let text = '';
  if (nodeId) text = await tryCall({ nodeId }).catch(() => '');
  if (!text) text = await tryCall({}).catch(() => '');
  if (!text) {
    throw new Error('Figma MCP 返回空数据:请在 Figma 桌面里选中要测的画板/页面,或检查节点/权限');
  }
  return text;
}

/**
 * 官方 Dev Mode MCP(Figma 桌面 App,http://127.0.0.1:3845/mcp)——无需 token,
 * 授权靠桌面 App 已登录会话。需先在 Figma 桌面开启 Dev Mode → Enable MCP server。
 */
export async function fetchFigmaViaDesktop(
  nodeId: string | undefined,
  endpoint = 'http://127.0.0.1:3845/mcp',
): Promise<string> {
  const transport = new StreamableHTTPClientTransport(new URL(endpoint));
  const client = new Client({ name: 'testpilot', version: '0.2.0' }, { capabilities: {} });
  try {
    await client.connect(transport);
  } catch {
    throw new Error(
      '连不上 Figma 桌面 MCP(127.0.0.1:3845):请打开 Figma 桌面 App → Dev Mode → 启用 MCP server;' +
        '或用 --figma-token 走个人令牌方式。',
    );
  }
  try {
    return await callDesignTool(client, nodeId);
  } finally {
    await client.close().catch(() => {});
  }
}

/**
 * Framelink figma-developer-mcp(stdio)——需 FIGMA_API_KEY 个人令牌,无需桌面 App。
 */
export async function fetchFigmaViaToken(urlOrKey: string, apiKey?: string): Promise<string> {
  const key = apiKey ?? process.env.FIGMA_API_KEY;
  if (!key) throw new Error('缺少 Figma 凭证:设置 FIGMA_API_KEY,或用默认的桌面 MCP 授权方式');
  const { fileKey, nodeId } = parseFigmaUrl(urlOrKey);
  if (!fileKey) throw new Error('token 方式需要有效的 Figma 链接或 fileKey');

  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['-y', 'figma-developer-mcp', `--figma-api-key=${key}`, '--stdio'],
  });
  const client = new Client({ name: 'testpilot', version: '0.2.0' }, { capabilities: {} });
  try {
    await client.connect(transport);
    const result = (await client.callTool({
      name: 'get_figma_data',
      arguments: nodeId ? { fileKey, nodeId } : { fileKey },
    })) as { content?: Array<{ type: string; text?: string }> };
    const text = extractText(result);
    if (!text) throw new Error('Figma MCP 返回空数据,请确认 fileKey/node 与令牌权限');
    return text;
  } finally {
    await client.close().catch(() => {});
  }
}

/** 统一入口:source=desktop(默认,无 token)| token(个人令牌) */
export async function fetchFigmaContext(
  urlOrKey: string,
  opts: { source?: 'desktop' | 'token'; apiKey?: string } = {},
): Promise<string> {
  const { nodeId } = parseFigmaUrl(urlOrKey);
  if (opts.source === 'token') return fetchFigmaViaToken(urlOrKey, opts.apiKey);
  return fetchFigmaViaDesktop(nodeId);
}
