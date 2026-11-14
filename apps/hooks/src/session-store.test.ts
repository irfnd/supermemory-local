import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionStore } from '@/session-store.ts';

const store = () =>
	new SessionStore({ logFile: '/dev/null', syncDir: fs.mkdtempSync(path.join(os.tmpdir(), 'sm-store-')) }, { info() {} });

test('firstTime lets only the first of several identical stores through', () => {
	const s = store();
	expect(s.firstTime('s1', 'stop', 'same summary')).toBe(true);
	expect(s.firstTime('s1', 'stop', 'same summary')).toBe(false);
	expect(s.firstTime('s1', 'stop', 'another summary')).toBe(true);
	expect(s.firstTime('s1', 'compact', 'same summary')).toBe(true);
	expect(s.firstTime(undefined, 'stop', 'same summary')).toBe(true);
});

test('marker, seen ids and start cache round-trip per session', () => {
	const s = store();
	expect(s.readMarker('s1')).toBeUndefined();
	s.writeMarker('s1', [{ id: 'a', createdAt: '2026-01-01T00:00:00Z' }]);
	expect(s.readMarker('s1')).toBe('2026-01-01T00:00:00Z');
	s.markSeen('s1', ['x', 'y']);
	expect(s.seen('s1').has('y')).toBe(true);
	expect(s.cached('s1', 60_000)).toBeUndefined();
	s.cache('s1', 'ctx');
	expect(s.cached('s1', 60_000)).toBe('ctx');
	expect(s.cached('s1', -1)).toBeUndefined();
});
