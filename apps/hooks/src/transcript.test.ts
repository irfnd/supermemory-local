import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { trimCompactSummary } from '@/text.ts';
import { lastAgyReply, lastTranscriptText } from '@/transcript.ts';

const tmpFile = (name: string, rows: object[]) => {
	const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sm-')), name);
	fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n'));
	return file;
};

test('compaction summary is read from the transcript and unwrapped', () => {
	const summary =
		'This session is being continued from a previous conversation.\n\nSummary:\n1. Intent: X\n2. Pending: Y\n\nIf you need specific details from before compaction, read the full transcript at: /t.jsonl\nContinue the conversation.';
	const file = tmpFile('t.jsonl', [
		{ type: 'user', isCompactSummary: true, message: { content: 'old summary' } },
		{ type: 'user', isCompactSummary: true, message: { content: summary } },
		{ type: 'assistant', message: { content: [{ type: 'text', text: 'reply after' }] } },
	]);
	expect(trimCompactSummary(lastTranscriptText(file, (entry) => entry.isCompactSummary))).toBe('1. Intent: X\n2. Pending: Y');
	expect(lastTranscriptText(file, (entry) => entry.type === 'assistant')).toBe('reply after');
});

test('lastAgyReply picks the last PLANNER_RESPONSE with text, skipping tool-call steps', () => {
	const file = tmpFile('agy.jsonl', [
		{ type: 'PLANNER_RESPONSE', content: 'first reply' },
		{ type: 'PLANNER_RESPONSE', tool_calls: [{ name: 'write_file' }] },
		{ type: 'GENERIC', status: 'ERROR', content: 'tool call denied' },
		{ type: 'PLANNER_RESPONSE', content: 'final reply' },
		{ type: 'PLANNER_RESPONSE', tool_calls: [] },
	]);
	expect(lastAgyReply(file)).toBe('final reply');
	fs.unlinkSync(file);
	expect(lastAgyReply(file)).toBe('');
});
