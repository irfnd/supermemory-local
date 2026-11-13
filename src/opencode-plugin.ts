// supermemory-local: per-project persistent memory plugin for OpenCode 2.x
// Bridge to bin/supermemory-hook.ts. Template: installer.ts rewrites HOOK_CMD and copies this
// into ~/.config/opencode/plugins/supermemory-local.ts
// ponytail: no `Plugin.define` import (@opencode/plugin isn't installed here); a plain { id, setup } default export is what the loader checks

const HOOK_CMD = ['bun', 'bin/supermemory-hook.ts'];

// Full recall once per session, then each model call appends what other agents/sessions stored since.
// ponytail: only the newest MAX_DELTAS deltas are kept after the start block, so the system prompt stays bounded
const MAX_DELTAS = 5;
// the context hook runs before every model call; re-poll for other agents' memories at most this often
const SYNC_EVERY_MS = 30_000;

export default {
	id: 'supermemory-local',
	async setup(ctx: any) {
		const directory: string = ctx.location.directory;
		const run = async (event: string, payload: Record<string, unknown>): Promise<string> => {
			try {
				const proc = Bun.spawn([...HOOK_CMD, 'opencode', event], {
					stdin: new Blob([JSON.stringify({ cwd: directory, ...payload })]),
					stdout: 'pipe',
					stderr: 'ignore',
				});
				return await new Response(proc.stdout).text();
			} catch {
				return '';
			}
		};

		const context = new Map<string, string[]>();
		const lastSync = new Map<string, number>();
		const controller = new AbortController();

		// ponytail: registrations are NOT awaited. An awaited `hook()` inside `setup` can wait on the server while the server waits on
		// `setup`, and `opencode run` then hangs for good (seen repeatedly; with the plugin parked the same run takes 5s)
		const hooks = [
			// Replaces v1 experimental.chat.system.transform. Awaited: its output is the system prompt.
			ctx.session.hook('context', async (event: any) => {
				const id: string = event.sessionID ?? 'default';
				const blocks = context.get(id) ?? [];
				if (!blocks.length || Date.now() - (lastSync.get(id) ?? 0) >= SYNC_EVERY_MS) {
					lastSync.set(id, Date.now());
					const delta = (await run(blocks.length ? 'sync' : 'start', { sessionID: id })).trim();
					if (delta) blocks.push(delta);
					if (blocks.length > MAX_DELTAS + 1) blocks.splice(1, 1);
					context.set(id, blocks);
				}
				if (blocks.length) event.system.push({ type: 'text', text: blocks.join('\n\n') });
			}),
			// Replaces v1 tool.execute.after. Fire-and-forget: saving a change must not delay the agent.
			// ponytail: unawaited saves are lost if OpenCode exits mid-write
			ctx.tool.hook('execute.after', (event: any) => {
				if (event.status !== 'completed') return;
				void run('change', { tool: event.tool, args: event.input });
			}),
		];

		// Replaces v1 session.idle / session.compacted. v2 has no idle event: a turn ends with session.execution.succeeded, and the
		// reply is the last session.text.ended. Both stores are fire-and-forget like the tool hook.
		// ponytail: session.compaction.ended's payload is undocumented; `summary`/`text` is a guess, and an empty one is skipped by the hook
		const lastReply = new Map<string, string>();
		const types = ['session.text.ended', 'session.execution.succeeded', 'session.compaction.ended'];
		(async () => {
			for await (const { type, data } of ctx.event.subscribe({ types, signal: controller.signal })) {
				const sessionID: string = data?.sessionID;
				if (type === 'session.text.ended') lastReply.set(sessionID, data.text ?? '');
				else if (type === 'session.execution.succeeded') {
					void run('stop', { sessionID, summary: lastReply.get(sessionID) ?? '' });
					lastReply.delete(sessionID);
				} else void run('compact', { sessionID, summary: data?.summary ?? data?.text ?? '' });
			}
		})().catch(() => {});

		return () => {
			controller.abort();
			for (const h of hooks) void Promise.resolve(h).then((r) => r?.dispose?.());
		};
	},
};
