// Unit checks for the transforms that guard memory quality and sync: bun test
import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lastTranscriptText, newSince, pickHits, stripContext, trimCompactSummary } from './hook-handler.ts';
import { rewriteBody } from './llm-proxy.ts';
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

test('rewriteBody sets stream:false on chat and dimensions on embeddings, only when unset', () => {
	expect(JSON.parse(rewriteBody('{"model":"m"}', '/chat/completions')).stream).toBe(false);
	expect(JSON.parse(rewriteBody('{"stream":true}', '/chat/completions')).stream).toBe(true);
	expect(rewriteBody('not json', '/chat/completions')).toBe('not json');
	expect(rewriteBody('', '/chat/completions')).toBe('');
	expect(JSON.parse(rewriteBody('{"input":"x"}', '/embeddings', 1024))).toEqual({ input: 'x', dimensions: 1024 });
	expect(JSON.parse(rewriteBody('{"input":"x","dimensions":768}', '/embeddings', 1024)).dimensions).toBe(768);
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

test('pickHits drops own-session and already-seen hits and keeps one chunk per document, two at most', () => {
	const mem = (id: string, session = 'other') => ({ id, memory: id, similarity: 0.8, metadata: { session } });
	const chunk = (id: string, doc: string) => ({ id, chunk: id, similarity: 0.7, metadata: {}, documents: [{ id: doc }] });
	const hits = [
		mem('m1'),
		mem('m2', 'me'),
		mem('m3'),
		chunk('c1', 'd1'),
		chunk('c2', 'd1'),
		chunk('c3', 'd2'),
		chunk('c4', 'd3'),
	];
	expect(pickHits(hits, 'me', new Set(['m3'])).map((h) => h.id)).toEqual(['m1', 'c1', 'c3']);
});
