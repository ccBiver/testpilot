/**
 * 敏感操作护栏:探索是无人值守的,绝不能真实下单/删数据/发消息。
 * 命中词表的交互目标直接跳过,并记录被拦截原因。
 */

const SENSITIVE_WORDS = [
  // 资金
  '支付', '付款', '下单', '购买', '充值', '提现', '转账', '打赏',
  'pay', 'checkout', 'purchase', 'buy now', 'place order',
  // 破坏性
  '删除', '注销', '清空', '解绑', '移除',
  'delete', 'remove', 'destroy', 'deactivate',
  // 对外发送
  '发送', '发布', '提交订单', '群发',
  'send', 'publish', 'post comment',
  // 登出会打断探索
  '退出登录', '登出', 'logout', 'sign out',
] as const;

export interface GuardrailVerdict {
  allowed: boolean;
  matchedWord?: string;
}

/** 判断一段交互目标文本(按钮文案/链接文字/AI 指令)是否允许执行 */
export function checkGuardrail(targetText: string): GuardrailVerdict {
  const normalized = targetText.toLowerCase().trim();
  if (!normalized) return { allowed: true };
  for (const word of SENSITIVE_WORDS) {
    if (normalized.includes(word)) {
      return { allowed: false, matchedWord: word };
    }
  }
  return { allowed: true };
}
