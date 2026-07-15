import { motion } from 'framer-motion';
import { useEffect, useState, type FormEvent } from 'react';
import ConsoleShell from '../components/ConsoleShell';
import RunnerTokenSection from '../components/RunnerTokenSection';
import { IconSparkles } from '../components/Icons';
import { DotLoader, GhostButton, GradientButton, TextInput } from '../components/Ui';
import { api, ApiError, type ApiModelConfig } from '../lib/api';

const DASHSCOPE_PRESET = {
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  modelName: 'qwen-vl-max-latest',
  vlMode: 'qwen' as const,
};

/** 设置页:模型 API Key 配置(BYOK),AI 探索模式的供能来源 */
export default function Settings() {
  const [existing, setExisting] = useState<ApiModelConfig | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [modelName, setModelName] = useState('');
  const [vlMode, setVlMode] = useState<'none' | 'qwen'>('none');
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api
      .getModelConfig()
      .then((cfg) => {
        if (cfg) {
          setExisting(cfg);
          setBaseUrl(cfg.baseUrl);
          setModelName(cfg.modelName);
          setVlMode(cfg.vlMode);
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const applyPreset = () => {
    setBaseUrl(DASHSCOPE_PRESET.baseUrl);
    setModelName(DASHSCOPE_PRESET.modelName);
    setVlMode(DASHSCOPE_PRESET.vlMode);
    setMessage(null);
  };

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setSaving(true);
    try {
      const cfg = await api.saveModelConfig({
        apiKey: apiKey.trim() || undefined,
        baseUrl: baseUrl.trim(),
        modelName: modelName.trim(),
        vlMode,
      });
      setExisting(cfg);
      setApiKey('');
      setMessage({ kind: 'ok', text: '已保存,AI 探索模式可用了 🎉' });
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof ApiError ? err.message : '保存失败,请稍后再试' });
    } finally {
      setSaving(false);
    }
  };

  const onClear = async () => {
    if (!window.confirm('确定清除模型配置?清除后 AI 探索将不可用。')) return;
    await api.clearModelConfig().catch(() => {});
    setExisting(null);
    setApiKey('');
    setBaseUrl('');
    setModelName('');
    setVlMode('none');
    setMessage({ kind: 'ok', text: '已清除模型配置' });
  };

  return (
    <ConsoleShell>
      {() => (
        <div>
          <h1 className="text-2xl font-black">设置</h1>
          <p className="mt-1 text-sm text-slate-400">
            配置你自己的多模态模型 Key(BYOK),AI 探索用它供能,费用走你的模型账号。
          </p>

          {loaded && (
            <motion.form
              onSubmit={onSave}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-6 max-w-xl rounded-2xl border border-slate-100 bg-white p-6 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-bold">AI 模型(BYOK)</h2>
                <button
                  type="button"
                  onClick={applyPreset}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-600 transition-colors hover:bg-indigo-100"
                >
                  <IconSparkles className="h-3.5 w-3.5" /> 一键填入 DashScope 推荐配置
                </button>
              </div>

              {existing && (
                <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
                  当前已配置:{existing.modelName} · Key {existing.apiKeyMasked} ·
                  更新于 {new Date(existing.updatedAt).toLocaleString('zh-CN')}
                </p>
              )}

              <div className="mt-4 space-y-4">
                <TextInput
                  label={existing ? 'API Key(留空则沿用已保存的 Key)' : 'API Key'}
                  type="password"
                  placeholder={existing ? existing.apiKeyMasked : 'sk-…'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  autoComplete="off"
                />
                <TextInput
                  label="接口地址(OpenAI 兼容)"
                  placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
                <TextInput
                  label="模型名称"
                  placeholder="qwen-vl-max-latest"
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                />
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={vlMode === 'qwen'}
                    onChange={(e) => setVlMode(e.target.checked ? 'qwen' : 'none')}
                    className="h-4 w-4 accent-indigo-500"
                  />
                  Qwen-VL 兼容模式(使用 DashScope 的 qwen-vl 系列时勾选)
                </label>
              </div>

              {message && (
                <motion.p
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  className={`mt-4 rounded-xl px-3 py-2 text-sm font-medium ${
                    message.kind === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'
                  }`}
                >
                  {message.text}
                </motion.p>
              )}

              <div className="mt-5 flex gap-3">
                <GradientButton type="submit" disabled={saving} className="!px-5 !py-2.5 text-sm">
                  {saving ? <DotLoader /> : '保存配置'}
                </GradientButton>
                {existing && (
                  <GhostButton type="button" onClick={onClear} className="!px-5 !py-2.5 text-sm">
                    清除配置
                  </GhostButton>
                )}
              </div>

              <p className="mt-4 text-xs leading-relaxed text-slate-400">
                Key 使用 AES-256-GCM 加密存储,页面与接口永不回显明文。
                没有 Key?去阿里云百炼(DashScope)控制台创建,新账号有免费额度。
              </p>
            </motion.form>
          )}

          <RunnerTokenSection />
        </div>
      )}
    </ConsoleShell>
  );
}
