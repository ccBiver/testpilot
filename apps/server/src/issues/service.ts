import type { PrismaClient } from '@prisma/client';
import type { Finding, RunReport } from '@testpilot/shared';

export const ISSUE_STATUSES = ['open', 'confirmed', 'fixing', 'closed', 'false_positive'] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

const SEVERITY_RANK: Record<string, number> = { critical: 3, high: 2, medium: 1, low: 0 };

function maxSeverity(a: string, b: string): string {
  return (SEVERITY_RANK[a] ?? 0) >= (SEVERITY_RANK[b] ?? 0) ? a : b;
}

interface RunRef {
  id: string;
  projectId: string;
  userId: string;
}

/**
 * 运行完成后把 Findings 聚合进看板 Issue:
 * - 同项目同指纹只有一条 Issue,重复出现累计 occurrences 并刷新最近快照
 * - 严重级别取历次最高
 * - closed 复发 → 自动重开(回归);false_positive 保持静默不重开
 */
export async function upsertIssuesFromRun(
  prisma: PrismaClient,
  run: RunRef,
  report: RunReport,
): Promise<void> {
  for (const finding of report.findings) {
    await upsertOne(prisma, run, finding);
  }
}

async function upsertOne(prisma: PrismaClient, run: RunRef, finding: Finding): Promise<void> {
  const where = {
    projectId_fingerprint: { projectId: run.projectId, fingerprint: finding.fingerprint },
  };
  const existing = await prisma.issue.findUnique({ where });

  if (!existing) {
    await prisma.issue.create({
      data: {
        projectId: run.projectId,
        userId: run.userId,
        fingerprint: finding.fingerprint,
        detector: finding.detector,
        severity: finding.severity,
        title: finding.title,
        findingJson: JSON.stringify(finding),
        firstRunId: run.id,
        lastRunId: run.id,
      },
    });
    return;
  }

  const reopened = existing.status === 'closed';
  await prisma.issue.update({
    where,
    data: {
      occurrences: existing.occurrences + 1,
      severity: maxSeverity(existing.severity, finding.severity),
      title: finding.title,
      findingJson: JSON.stringify(finding),
      lastRunId: run.id,
      lastSeenAt: new Date(),
      ...(reopened ? { status: 'open' } : {}),
    },
  });
}
