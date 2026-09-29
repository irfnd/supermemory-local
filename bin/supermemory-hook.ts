#!/usr/bin/env bun
// Hook entrypoint for all agents: bun --env-file=<repo>/.env bin/supermemory-hook.ts <agent> <action>
// (--env-file stops Bun from auto-loading the .env of whatever project the agent is working in)
import { log, runHook } from '../src/hook-handler.ts';

const agent = process.argv[2] || 'generic'; // 'claude-code' | 'antigravity' | 'opencode'
const action = process.argv[3] || 'check'; // 'start' | 'change' | 'stop'

try {
	await runHook(agent, action);
} catch (err) {
	// Always fail safe: never block the agent CLI
	log(`Hook error (${agent} ${action}): ${(err as Error).stack || err}`);
	if (agent === 'antigravity') console.log(JSON.stringify({}));
}
process.exit(0);
