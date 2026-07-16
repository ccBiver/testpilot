import { motion } from 'framer-motion';
import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, type ApiPlatformModel } from '../lib/api';
import { IconSparkles } from './Icons';
import { DotLoader, GradientButton, TextInput } from './Ui';

const DASHSCOPE_PRESET = {
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  modelName: 'qwen-vl-max-latest',
  vlMode: 'qwen' as const,
};

/** 管理后台:平台模型配置(全平台 AI 探索统一供能)+ 注册开关 */
export default function PlatformSettingsSection() {
  const [model, setModel] = useState<ApiPlatformModel | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [modelName, setModelName] = useState('');
  const [vlMode, setVlMode] = useState<'none' | 'qwen'>('none');
  const [registration, setRegistration] = useState(true);
  const [defaultQuota, setDefaultQuota] = useState('10');
  const [quotaSaved, setQuotaSaved] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .adminGetModelConfig()
      .then((m) => {
        if (m) {
          setModel(m);
          setBaseUrl(m.baseUrl);
          setModelName(m.modelName);
          setVlMode(m.vlMode === 'qwen' ? 'qwen' : 'none');
        }
      })
      .catch(() => {});
    api.adminGetRegistration().then(setRegistration).catch(() => {});
    api.adminGetQuota().then((n) => setDefaultQuota(String(n))).catch(() => {});
  }, []);

  const saveQuota = async () => {
    const value = Number(defaultQuota);
    if (!Number.isInteger(value) || value < 0) {
      setMessage({ kind: 'err', text: '默认额度必须是非负整数' });
      return;
    }
    try {
      await api.adminSetQuota(value);
      setQuotaSaved(true);
      setTimeout(() => setQuotaSaved(false), 2000);
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof ApiError ? err.message : '保存失败' });
    }
  };

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
      const saved = await api.adminSaveModelConfig({
        apiKey: apiKey.trim() || undefined,
        baseUrl: baseUrl.trim(),
        modelName: modelName.trim(),
        vlMode,
      });
      setModel(saved);
      setApiKey('');
      setMessage({ kind: 'ok', text: '已保存,全平台 AI 探索已就绪' });
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof ApiError ? err.message : '保存失败,请稍后再试' });
    } finally {
      setSaving(false);
    }
  };

  const toggleRegistration = async () => {
    const next = !registration;
    if (!next && !window.confirm('确定关闭注册?新用户将无法注册,已有用户不受影响。')) return;
    try {
      await api.adminSetRegistration(next);
      setRegistration(next);
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof ApiError ? err.message : '操作失败' });
    }
  };

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_300px]">
      <motion.form
        onSubmit={onSave}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">平台 AI 模型</h2>
          <button
            type="button"
            onClick={applyPreset}
            className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-600 transition-colors hover:bg-indigo-100"
          >
            <IconSparkles className="h-3.5 w-3.5" /> 一键填入 DashScope 推荐配置
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-400">
          全平台用户的 AI 探索统一由这里的模型供能,费用走平台账号(商业化计量基础)。
        </p>

        {model?.hasApiKey && (
          <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
            当前已配置:{model.modelName || '(未填模型名)'} · API Key 已保存(加密存储,不回显)
          </p>
        )}

        <div className="mt-4 space-y-4">
          <TextInput
            label={model?.hasApiKey ? 'API Key(留空则沿用已保存的 Key)' : 'API Key'}
            type="password"
            placeholder="sk-…"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="off"
          />
          <TextInput
            label="接口地址(OpenAI 兼容)"
            placeholder={DASHSCOPE_PRESET.baseUrl}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
          <TextInput
            label="模型名称"
            placeholder={DASHSCOPE_PRESET.modelName}
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

        <GradientButton type="submit" disabled={saving} className="mt-5 !px-5 !py-2.5 text-sm">
          {saving ? <DotLoader /> : '保存模型配置'}
        </GradientButton>
      </motion.form>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
        className="h-fit rounded-2xl border border-slate-100 bg-white p-6 shadow-sm"
      >
        <h2 className="font-bold">注册开关</h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          关闭后新用户无法注册,已有用户登录不受影响。
        </p>
        <button
          type="button"
          onClick={toggleRegistration}
          className={`mt-4 inline-flex h-7 w-13 cursor-pointer items-center rounded-full p-1 transition-colors ${
            registration ? 'bg-gradient-to-r from-indigo-500 to-pink-500' : 'bg-slate-200'
          }`}
          aria-label="切换注册开关"
        >
          <span
            className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${
              registration ? 'translate-x-6' : 'translate-x-0'
            }`}
          />
        </button>
        <p className={`mt-2 text-xs font-semibold ${registration ? 'text-emerald-600' : 'text-slate-400'}`}>
          {registration ? '开放注册中' : '已关闭注册'}
        </p>

        <div className="mt-6 border-t border-slate-100 pt-5">
          <h2 className="font-bold">新用户免费额度</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            注册即赠送的 AI 探索次数,仅对之后注册的新用户生效。
          </p>
          <div className="mt-3 flex items-center gap-2">
            <input
              type="number"
              min={0}
              value={defaultQuota}
              onChange={(e) => setDefaultQuota(e.target.value)}
              className="input-glow w-24 rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm outline-none"
            />
            <span className="text-xs text-slate-400">次</span>
            <button
              type="button"
              onClick={saveQuota}
              className="cursor-pointer rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-600 transition-colors hover:bg-indigo-100"
            >
              {quotaSaved ? '已保存 ✓' : '保存'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
