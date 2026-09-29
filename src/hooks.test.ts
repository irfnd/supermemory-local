// Unit checks for the transforms that guard memory quality and sync: bun test
import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lastTranscriptText, newSince, stripContext, trimCompactSummary } from './hook-handler.ts';
import { forceNonStream } from './llm-proxy.ts';
import { cleanText } from './zed-adapter.ts';

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

test('forceNonStream sets stream:false only when unset', () => {
	expect(JSON.parse(forceNonStream('{"model":"m"}')).stream).toBe(false);
	expect(JSON.parse(forceNonStream('{"stream":true}')).stream).toBe(true);
	expect(forceNonStream('not json')).toBe('not json');
	expect(forceNonStream('')).toBe('');
});

test('newSince keeps only newer docs from other sessions', () => {
	const doc = (id: string, createdAt: string, session?: string) => ({ id, createdAt, metadata: { session } });
	const recent = [
		doc('a', '2026-01-03T00:00:00Z', 'other'),
		doc('b', '2026-01-02T00:00:00Z', 'me'),
		doc('c', '2026-01-01T00:00:00Z'),
	];
	expect(newSince(recent, '2026-01-01T00:00:00Z', 'me').map((d) => d.id)).toEqual(['a']);
	expect(newSince(recent, '', 'me').map((d) => d.id)).toEqual(['a', 'c']);
});

test('compaction summary is read from the transcript and unwrapped', () => {
	const summary =
		'This session is being continued from a previous conversation.\n\nSummary:\n1. Intent: X\n2. Pending: Y\n\nIf you need specific details from before compaction, read the full transcript at: /t.jsonl\nContinue the conversation.';
	const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sm-')), 't.jsonl');
	const lines = [
		{ type: 'user', isCompactSummary: true, message: { content: 'old summary' } },
		{ type: 'user', isCompactSummary: true, message: { content: summary } },
		{ type: 'assistant', message: { content: [{ type: 'text', text: 'reply after' }] } },
	];
	fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n'));
	expect(trimCompactSummary(lastTranscriptText(file, (e) => e.isCompactSummary))).toBe('1. Intent: X\n2. Pending: Y');
	expect(lastTranscriptText(file, (e) => e.type === 'assistant')).toBe('reply after');
});

test('zed-adapter cleanText unwraps fences, applies stop and restores zeta markers', () => {
	const [s, e] = ['<|editable_region_start|>', '<|editable_region_end|>'];
	expect(cleanText('```python\nfoo()\n```')).toBe('foo()');
	expect(cleanText('abc<|endoftext|>junk', ['<|endoftext|>'])).toBe('abc');
	expect(cleanText(undefined)).toBe('');
	expect(cleanText('x = 1', [], `a ${s} b`)).toBe(`${s}\nx = 1\n${e}`);
	expect(cleanText(`${s}\nx\n${e}`, [], s)).toBe(`${s}\nx\n${e}`);
});
