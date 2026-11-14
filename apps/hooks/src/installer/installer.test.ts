import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LOGGER } from '@supermemory-local/shared/logger';
import { loadInstallerPaths } from '@/installer/config.ts';
import { createContainer } from '@/installer/container.ts';
import { InstallerCli } from '@/installer/installer-cli.ts';

const setup = () => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-home-'));
	const paths = loadInstallerPaths(home);
	const container = createContainer(paths);
	container.register(LOGGER, { useValue: { info() {} } });
	return { paths, cli: container.resolve(InstallerCli) };
};
const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf-8'));

test('install is idempotent and keeps foreign Claude Code hooks, uninstall removes only ours', () => {
	const { paths, cli } = setup();
	fs.mkdirSync(path.dirname(paths.claudeSettings), { recursive: true });
	const foreign = { matcher: '', hooks: [{ type: 'command', command: 'echo foreign' }] };
	fs.writeFileSync(paths.claudeSettings, JSON.stringify({ hooks: { Stop: [foreign] } }));

	expect(cli.run('install', 'claude-code')).toBe(true);
	expect(cli.run('install', 'claude-code')).toBe(true);
	const stop = readJson(paths.claudeSettings).hooks.Stop;
	expect(stop).toHaveLength(2);
	expect(stop[0]).toEqual(foreign);
	expect(JSON.stringify(stop[1])).toContain('supermemory-hook.ts');

	expect(cli.run('uninstall', 'claude-code')).toBe(true);
	expect(readJson(paths.claudeSettings).hooks.Stop).toEqual([foreign]);
});

test('antigravity hook and opencode plugin are written with the absolute hook command', () => {
	const { paths, cli } = setup();
	cli.run('install', 'all');

	const agy = readJson(paths.antigravityHooks)['supermemory-local'];
	expect(agy.PreInvocation[0].command).toContain(paths.hookBin);
	const plugin = fs.readFileSync(path.join(paths.opencodeDir, 'plugins', 'supermemory-local.ts'), 'utf-8');
	expect(plugin).toContain(JSON.stringify([paths.bun, `--env-file=${paths.envFile}`, paths.hookBin]));

	cli.run('uninstall', 'all');
	expect(readJson(paths.antigravityHooks)['supermemory-local']).toBeUndefined();
	expect(fs.existsSync(path.join(paths.opencodeDir, 'plugins', 'supermemory-local.ts'))).toBe(false);
});

test('unknown action or target is rejected', () => {
	const { cli } = setup();
	expect(cli.run('explode', 'all')).toBe(false);
	expect(cli.run('install', 'vim')).toBe(false);
});
