import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { TestCaseSuite } from '@testpilot/shared';

const stepSchema = z.object({
  action: z.string().min(1),
  expect: z.string().optional(),
});

const caseSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  source: z.enum(['manual', 'doc', 'figma', 'both']).optional(),
  steps: z.array(stepSchema).min(1),
});

// 生成阶段不绑定目标/平台,故二者可选;执行时由 --target/--platform 提供
const suiteSchema = z.object({
  target: z.string().optional(),
  platform: z.enum(['web', 'android']).optional(),
  cases: z.array(caseSchema).min(1),
});

/** 读取并校验用例文件(.yaml/.yml/.json),补全用例 id */
export async function loadSuite(filePath: string): Promise<TestCaseSuite> {
  const raw = await readFile(filePath, 'utf8');
  const data = /\.ya?ml$/i.test(filePath) ? parseYaml(raw) : JSON.parse(raw);
  const parsed = suiteSchema.parse(data);
  return {
    ...parsed,
    cases: parsed.cases.map((c, i) => ({ ...c, id: c.id ?? `case-${i + 1}` })),
  };
}
