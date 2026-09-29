// Hook installer & uninstaller for Claude Code, Antigravity, and OpenCode
// Usage: bun src/installer.ts [install|uninstall] [all|claude-code|antigravity|opencode]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(import.meta.dir, '..');
const HOOK_BIN = path.join(PROJECT_ROOT, 'bin', 'supermemory-hook.ts');
const ENV_FILE = path.join(PROJECT_ROOT, '.env');
// Absolute bun path: GUI-launched agents (Antigravity) often lack ~/.bun/bin in PATH
const BUN = process.execPath;
// Matches entries from this installer, including the old node/.js ones
const MARKER = /supermemory-hook\.(js|ts)/;
const HOME = os.homedir();

const CLAUDE_SETTINGS = path.join(HOME, '.claude', 'settings.json');
const ANTIGRAVITY_HOOKS = path.join(HOME, '.gemini', 'config', 'hooks.json');
const OPENCODE_DIR = path.join(HOME, '.config', 'opencode');
const OPENCODE_PLUGIN = path.join(OPENCODE_DIR, 'plugins', 'supermemory-local.ts');
const OPENCODE_LEGACY_PLUGIN = path.join(OPENCODE_DIR, 'plugins', 'supermemory-local.js');
const OPENCODE_CONFIG = path.join(OPENCODE_DIR, 'opencode.json');

type Json = Record<string, any>;

const hookCmd = (agent: string, action: string) => `"${BUN}" --env-file="${ENV_FILE}" "${HOOK_BIN}" ${agent} ${action}`;
const command = (agent: string, action: string) => ({
	type: 'command',
	command: hookCmd(agent, action),
	timeout: 15,
});

/** Parsed JSON file ({} if missing), backed up before we touch it. Throws on bad JSON rather than overwrite it. */
function readConfig(file: string): Json {
	if (!fs.existsSync(file)) return {};
	const backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
	fs.copyFileSync(file, backup);
	console.log(`   [backup] Created backup: ${backup}`);
	return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function writeConfig(file: string, data: Json) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

/** Claude Code hook groups for one event, minus any previously installed supermemory entries */
function withoutOurs(groups: unknown): Json[] {
	return Array.isArray(groups) ? groups.filter((g) => !MARKER.test(JSON.stringify(g))) : [];
}

// ----------------------------------------------------
// Claude Code (~/.claude/settings.json)
// ----------------------------------------------------
function installClaudeCode() {
	console.log(`\n→ Configuring Claude Code hooks (${CLAUDE_SETTINGS})...`);
	const settings = readConfig(CLAUDE_SETTINGS);
	const hooks: Json = (settings.hooks ??= {});
	const add = (event: string, matcher: string, action: string) => {
		hooks[event] = [...withoutOurs(hooks[event]), { matcher, hooks: [command('claude-code', action)] }];
	};
	add('SessionStart', 'startup|resume|clear|compact', 'start');
	add('UserPromptSubmit', '', 'sync');
	add('PostToolUse', 'Write|Edit|MultiEdit|NotebookEdit|Bash', 'change');
	add('Stop', '', 'stop');
	add('PostCompact', '', 'compact');
	writeConfig(CLAUDE_SETTINGS, settings);
	console.log('✓ Claude Code hooks installed successfully.');
}

function uninstallClaudeCode() {
	console.log(`\n→ Removing Claude Code hooks (${CLAUDE_SETTINGS})...`);
	if (!fs.existsSync(CLAUDE_SETTINGS)) return;
	const settings = readConfig(CLAUDE_SETTINGS);
	for (const event of Object.keys(settings.hooks ?? {})) {
		settings.hooks[event] = withoutOurs(settings.hooks[event]);
	}
	writeConfig(CLAUDE_SETTINGS, settings);
	console.log('✓ Claude Code hooks uninstalled.');
}

// ----------------------------------------------------
// Antigravity (~/.gemini/config/hooks.json, one named top-level hook)
// ----------------------------------------------------
function installAntigravity() {
	console.log(`\n→ Configuring Antigravity hooks (${ANTIGRAVITY_HOOKS})...`);
	const hooksData = readConfig(ANTIGRAVITY_HOOKS);
	hooksData['supermemory-local'] = {
		enabled: true,
		PreInvocation: [command('antigravity', 'start')],
		PostToolUse: [{ matcher: 'write_to_file|replace_file_content|run_command', hooks: [command('antigravity', 'change')] }],
		Stop: [command('antigravity', 'stop')],
	};
	writeConfig(ANTIGRAVITY_HOOKS, hooksData);
	console.log('✓ Antigravity hooks installed successfully.');
}

function uninstallAntigravity() {
	console.log(`\n→ Removing Antigravity hooks (${ANTIGRAVITY_HOOKS})...`);
	if (!fs.existsSync(ANTIGRAVITY_HOOKS)) return;
	const hooksData = readConfig(ANTIGRAVITY_HOOKS);
	delete hooksData['supermemory-local'];
	writeConfig(ANTIGRAVITY_HOOKS, hooksData);
	console.log('✓ Antigravity hooks uninstalled.');
}

// ----------------------------------------------------
// OpenCode (~/.config/opencode/plugins/, auto-discovered)
// ----------------------------------------------------
function removeOpenCodeArtifacts() {
	if (fs.existsSync(OPENCODE_LEGACY_PLUGIN)) {
		fs.unlinkSync(OPENCODE_LEGACY_PLUGIN);
		console.log(`   [plugin] Removed old ${OPENCODE_LEGACY_PLUGIN}`);
	}
	// The plugins dir is auto-discovered; also listing the plugin in opencode.json loads it twice
	if (!fs.existsSync(OPENCODE_CONFIG)) return;
	const listed = JSON.parse(fs.readFileSync(OPENCODE_CONFIG, 'utf-8')).plugin;
	const isOurs = (p: unknown) => typeof p === 'string' && p.includes('supermemory-local.');
	if (Array.isArray(listed) && listed.some(isOurs)) {
		const config = readConfig(OPENCODE_CONFIG);
		config.plugin = listed.filter((p) => !isOurs(p));
		writeConfig(OPENCODE_CONFIG, config);
		console.log(`   [config] Removed plugin entry from ${OPENCODE_CONFIG}`);
	}
}

function installOpenCode() {
	console.log(`\n→ Configuring OpenCode plugin (${OPENCODE_DIR})...`);
	removeOpenCodeArtifacts();
	const hookCmdArray = [BUN, `--env-file=${ENV_FILE}`, HOOK_BIN];
	const pluginCode = fs
		.readFileSync(path.join(import.meta.dir, 'opencode-plugin.ts'), 'utf-8')
		.replace(/const HOOK_CMD = [^;]*;/, `const HOOK_CMD = ${JSON.stringify(hookCmdArray)};`);
	fs.mkdirSync(path.dirname(OPENCODE_PLUGIN), { recursive: true });
	fs.writeFileSync(OPENCODE_PLUGIN, pluginCode, 'utf-8');
	console.log(`   [plugin] Copied plugin to: ${OPENCODE_PLUGIN}`);
	console.log('✓ OpenCode plugin installed.');
}

function uninstallOpenCode() {
	console.log('\n→ Removing OpenCode plugin...');
	removeOpenCodeArtifacts();
	if (fs.existsSync(OPENCODE_PLUGIN)) {
		fs.unlinkSync(OPENCODE_PLUGIN);
		console.log(`   [plugin] Removed ${OPENCODE_PLUGIN}`);
	}
	console.log('✓ OpenCode plugin uninstalled.');
}

// ----------------------------------------------------
// Main CLI Runner
// ----------------------------------------------------
const TARGETS = {
	'claude-code': { install: installClaudeCode, uninstall: uninstallClaudeCode },
	antigravity: { install: installAntigravity, uninstall: uninstallAntigravity },
	opencode: { install: installOpenCode, uninstall: uninstallOpenCode },
};
type Target = keyof typeof TARGETS;

const action = process.argv[2] || 'install';
const target = process.argv[3] || 'all';

if (action !== 'install' && action !== 'uninstall') {
	console.error(`Unknown action: ${action}. Use 'install' or 'uninstall'.`);
	process.exit(1);
}
if (target !== 'all' && !(target in TARGETS)) {
	console.error(`Unknown target: ${target}. Use all, ${Object.keys(TARGETS).join(', ')}.`);
	process.exit(1);
}

console.log('========================================================');
console.log(` Supermemory Hooks Manager: ${action.toUpperCase()}`);
console.log(` Target CLI(s): ${target}`);
console.log(` Hook command:  ${hookCmd('<agent>', '<action>')}`);
console.log('========================================================');

const selected = (target === 'all' ? Object.keys(TARGETS) : [target]) as Target[];
for (const t of selected) TARGETS[t][action]();

console.log(`\n✨ All requested hooks ${action === 'install' ? 'installed' : 'uninstalled'}.`);
