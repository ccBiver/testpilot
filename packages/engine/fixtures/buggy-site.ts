import http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * 演示用「带 Bug 的站点」:M0 验收标准要求探索器能发现
 * ① JS 报错 ② 接口 500 ③ 死链 404。同时埋一个敏感按钮验证护栏。
 */

// 导航故意用 position:fixed:真实站点常见,曾导致 offsetParent 可见性判断漏掉全部导航链接
const page = (title: string, body: string) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>nav{position:fixed;top:0;left:0;right:0;background:#fff;padding:8px}main{padding-top:48px}</style></head>
<body><nav><a href="/">首页</a> <a href="/about">关于我们</a> <a href="/products">产品列表</a> <a href="/broken-page">帮助中心</a></nav>
<main><h1>${title}</h1>${body}</main></body></html>`;

const routes: Record<string, (res: http.ServerResponse) => void> = {
  '/': (res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      page(
        '演示商城',
        `<button onclick="console.error('TypeError: cart is undefined at cart.js:42')">加入购物车</button>
         <button onclick="fetch('/api/recommend')">查看推荐</button>
         <button onclick="alert('这个按钮不应被点击')">删除账号</button>`,
      ),
    );
  },
  '/about': (res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(page('关于我们', '<p>一切正常的页面。</p>'));
  },
  '/products': (res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      page(
        '产品列表',
        `<script>fetch('/api/products').then(r => { if (!r.ok) console.error('加载产品失败: HTTP ' + r.status) })</script>
         <p>产品加载中……</p>`,
      ),
    );
  },
  '/api/products': (res) => {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'database connection refused' }));
  },
  '/api/recommend': (res) => {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'recommend service down' }));
  },
  // /broken-page 故意不注册 → 404 死链
};

export async function startBuggySite(port = 0): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const handler = routes[req.url ?? '/'];
    if (handler) return handler(res);
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(page('404', '<p>页面不存在</p>'));
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const { port: boundPort } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${boundPort}/`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
