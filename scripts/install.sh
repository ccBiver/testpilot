#!/usr/bin/env bash
# 安装 testpilot 为全局命令:构建 CLI + 软链到 PATH 目录
# 用法:bash scripts/install.sh   (或 pnpm install:cli)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_SRC="$ROOT/apps/cli/dist/index.js"

# 选一个已在 PATH 里的 bin 目录
BIN_DIR=""
for cand in "$HOME/.local/bin" "/usr/local/bin"; do
  case ":$PATH:" in *":$cand:"*) BIN_DIR="$cand"; break ;; esac
done
if [ -z "$BIN_DIR" ]; then
  echo "未找到在 PATH 中的 bin 目录(试过 ~/.local/bin、/usr/local/bin)。" >&2
  echo "请手动把某个目录加入 PATH,或运行 pnpm setup 后用 pnpm link --global。" >&2
  exit 1
fi

echo "▶ 构建 CLI…"
( cd "$ROOT" && pnpm --filter testpilot-cli build >/dev/null )

chmod +x "$BIN_SRC"
mkdir -p "$BIN_DIR"
ln -sf "$BIN_SRC" "$BIN_DIR/testpilot"

echo "✅ 已安装:$BIN_DIR/testpilot -> $BIN_SRC"
echo "   现在任意目录可运行:testpilot --help"
