import type { core } from 'zod';

export function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function describeIssues(issues: readonly core.$ZodIssue[], limit: number): string {
  return issues.slice(0, limit).map(describeIssue).join('; ');
}

function describeIssue(issue: core.$ZodIssue): string {
  const path = issue.path.map((segment) => String(segment)).join('.');
  return path === '' ? issue.message : `${path}: ${issue.message}`;
}
