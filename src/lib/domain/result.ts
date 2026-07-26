import type { DomainIssue, ValidationResult } from './types';

export function valid(): ValidationResult {
	return { ok: true };
}

export function invalid(...issues: DomainIssue[]): ValidationResult {
	return { ok: false, issues };
}

export function issuesResult(issues: DomainIssue[]): ValidationResult {
	return issues.length === 0 ? valid() : { ok: false, issues };
}

export function issue(code: string, message: string, field?: string): DomainIssue {
	return { code, message, ...(field ? { field } : {}) };
}
