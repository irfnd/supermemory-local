import { expect, test } from 'bun:test';
import { isEnglish, isReadOnlyCommand, stripContext, trimCompactSummary } from '@/text.ts';

const block = (inner: string) => `<supermemory-context>\n# Shared Project Memory: p (/x)\n${inner}\n</supermemory-context>`;

test('stripContext removes nested, single and unclosed injected blocks', () => {
	expect(stripContext(`before ${block(`a ${block('b')}`)} after`)).toBe('before  after');
	expect(stripContext(`keep ${block('cut')}`)).toBe('keep');
	expect(stripContext('head\n<supermemory-context>\n# Shared Project Memory: p\ntruncated')).toBe('head');
});

test('stripContext keeps plain mentions of the tag in prose', () => {
	const prose = 'prose `<supermemory-context>` mention stays';
	expect(stripContext(prose)).toBe(prose);
});

test('isEnglish tells English prose from other languages', () => {
	expect(isEnglish('I fixed the login bug: the refresh token expired after 5 minutes because of the TTL unit.')).toBe(true);
	expect(isEnglish('Saya sudah memperbaiki bug login: token refresh kedaluwarsa setelah 5 menit karena satuan TTL.')).toBe(false);
	expect(isEnglish('kenapa token refresh cepat kedaluwarsa?')).toBe(false);
	expect(isEnglish('为什么刷新令牌很快过期')).toBe(false);
	expect(isEnglish('fix login bug')).toBe(true);
});

test('trimCompactSummary drops the continuation wrapper', () => {
	const wrapped =
		'This session is being continued from a previous conversation.\n\nSummary:\n1. Intent: X\n\nIf you need specific details from before compaction, read the transcript.';
	expect(trimCompactSummary(wrapped)).toBe('1. Intent: X');
	expect(trimCompactSummary('plain')).toBe('plain');
});

test('isReadOnlyCommand flags listing and inspection commands only', () => {
	expect(isReadOnlyCommand('git status')).toBe(true);
	expect(isReadOnlyCommand('cd /x && rtk ls -la')).toBe(true);
	expect(isReadOnlyCommand('bun test')).toBe(false);
	expect(isReadOnlyCommand('git commit -m x')).toBe(false);
});
