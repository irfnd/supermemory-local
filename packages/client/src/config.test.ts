import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, expect, test } from 'bun:test';
import { loadSupermemoryConfig } from '@supermemory-local/client/config';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-config-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const keyFile = path.join(dir, 'api-key');
fs.writeFileSync(keyFile, 'sm_local\n');

test('unset key reads the local key file, empty sends no key, explicit key wins', () => {
	expect(loadSupermemoryConfig({}, keyFile).apiKey).toBe('sm_local');
	expect(loadSupermemoryConfig({ SUPERMEMORY_API_KEY: '' }, keyFile).apiKey).toBe('');
	expect(loadSupermemoryConfig({ SUPERMEMORY_API_KEY: 'sm_remote' }, keyFile).apiKey).toBe('sm_remote');
	expect(loadSupermemoryConfig({}, path.join(dir, 'missing')).apiKey).toBe('');
});
