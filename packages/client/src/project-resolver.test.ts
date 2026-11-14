import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectResolver } from '@supermemory-local/client/project-resolver';

test('container tag is derived from the sanitized name and a hash of the real path', () => {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'My Project.')));
	const resolver = new ProjectResolver();
	const project = resolver.resolve(dir);

	expect(project.rootDir).toBe(dir);
	expect(project.containerTag).toMatch(/^proj_my-project-[a-z0-9]+_[0-9a-f]{6}$/);
	expect(resolver.resolve(dir).containerTag).toBe(project.containerTag);
	expect(resolver.resolve(path.join(dir, 'missing.txt')).projectName).toBe('missing.txt');
});
