import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Logger } from '@supermemory-local/shared/logger';
import type { Handler } from '@supermemory-local/shared/serve';

const DEFAULT_BIN = '/opt/homebrew/opt/curl-impersonate/bin/curl-impersonate';
const MAX_SECONDS = 600;
// curl-impersonate sets the browser's own values for these; forwarding them breaks the fingerprint or the framing
const DROPPED = new Set(['host', 'content-length', 'accept-encoding', 'connection']);

export class EgressProxy implements Handler {
	constructor(
		private readonly name: string,
		private readonly upstream: string,
		private readonly impersonate: string,
		private readonly logger: Logger,
	) {}

	async handle(req: Request): Promise<Response> {
		const { pathname, search } = new URL(req.url);
		if (pathname === '/health') return Response.json({ status: 'ok', upstream: this.upstream });
		const started = Date.now();
		const headerFile = path.join(os.tmpdir(), `egress-${process.pid}-${Math.random().toString(36).slice(2)}`);
		try {
			const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text();
			const args = [
				'-sS',
				'-N',
				'--compressed',
				'--impersonate',
				this.impersonate,
				'-X',
				req.method,
				'-D',
				headerFile,
				'--connect-timeout',
				'10',
				'--max-time',
				String(MAX_SECONDS),
			];
			for (const [key, value] of req.headers) if (!DROPPED.has(key)) args.push('-H', `${key}: ${value}`);
			if (body) args.push('--data-binary', '@-');
			args.push(this.target(pathname) + search);

			const proc = Bun.spawn([process.env.CURL_IMPERSONATE_BIN || DEFAULT_BIN, ...args], {
				stdin: body ? Buffer.from(body) : 'ignore',
				stdout: 'pipe',
				stderr: 'pipe',
			});
			const { status, contentType } = parseHead(await readHead(headerFile, proc));
			this.logger.info(`${this.name} ${req.method} ${pathname} ${status} ${Date.now() - started}ms`);
			proc.exited.then(async (code) => {
				fs.rmSync(headerFile, { force: true });
				const stderr = await new Response(proc.stderr).text();
				if (code !== 0 || stderr.trim()) this.logger.info(`${this.name} ${pathname} curl exit ${code}: ${stderr.trim()}`);
			});
			// piped as a stream: 9router answers chat with SSE, buffering it would stall the client until the end
			if (status === 204 || status === 304) return new Response(null, { status });
			return new Response(proc.stdout, { status, headers: { 'content-type': contentType } });
		} catch (err) {
			fs.rmSync(headerFile, { force: true });
			const message = (err as Error).message;
			this.logger.info(`${this.name} ${req.method} ${pathname} ERROR ${message}`);
			return Response.json({ error: { message: `egress-proxy: ${message}` } }, { status: 502 });
		}
	}

	// OPENAI_BASE_URL already carries /v1 and clients ask for /v1/... too: never double it
	private target(pathname: string): string {
		if (this.upstream.endsWith('/v1') && (pathname === '/v1' || pathname.startsWith('/v1/'))) {
			return this.upstream + pathname.slice(3);
		}
		return this.upstream + pathname;
	}
}

async function readHead(file: string, proc: Bun.Subprocess): Promise<string> {
	for (let i = 0; i < 3000; i++) {
		const head = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
		const last = lastBlock(head);
		if (last && !/^HTTP\/[\d.]+ 3\d\d/.test(last)) return head;
		if (proc.exitCode !== null) break;
		await Bun.sleep(5);
	}
	throw new Error('no response headers from upstream');
}

function lastBlock(head: string): string {
	return (
		head
			.split(/\r?\n\r?\n/)
			.filter((block) => block.startsWith('HTTP/'))
			.at(-1) ?? ''
	);
}

function parseHead(head: string): { status: number; contentType: string } {
	const block = lastBlock(head);
	return {
		status: Number(block.split(/\r?\n/)[0]?.split(/\s+/)[1]) || 502,
		contentType: /^content-type:\s*(.+)$/im.exec(block)?.[1]?.trim() || 'application/json',
	};
}
