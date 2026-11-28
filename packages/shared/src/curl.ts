import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_BIN = '/opt/homebrew/opt/curl-impersonate/bin/curl-impersonate';

export interface CurlRequestInit {
	method?: string;
	headers?: Record<string, string>;
	body?: string;
	timeoutMs?: number;
}

// Bun's fetch cannot set TLS/HTTP2 fingerprints, so remote calls shell out to libcurl-impersonate.
export async function curlFetch(
	url: string,
	{ method = 'GET', headers = {}, body, timeoutMs = 5000 }: CurlRequestInit,
	impersonate: string,
): Promise<Response> {
	const out = path.join(os.tmpdir(), `curl-impersonate-${process.pid}-${Math.random().toString(36).slice(2)}`);
	const args = [
		'-sS',
		'--compressed',
		'--impersonate',
		impersonate,
		'-X',
		method,
		'-o',
		out,
		'-w',
		'%{http_code}',
		'--max-time',
		(timeoutMs / 1000).toFixed(3),
	];
	for (const [key, value] of Object.entries(headers)) args.push('-H', `${key}: ${value}`);
	// c-ares does not use the macOS resolver; some routers time out on its queries (CURL_DNS_SERVERS=1.1.1.1)
	if (process.env.CURL_DNS_SERVERS) args.push('--dns-servers', process.env.CURL_DNS_SERVERS);
	if (body !== undefined) args.push('--data-binary', '@-');
	args.push(url);

	try {
		const proc = Bun.spawn([process.env.CURL_IMPERSONATE_BIN || DEFAULT_BIN, ...args], {
			stdin: body === undefined ? 'ignore' : Buffer.from(body),
			stdout: 'pipe',
			stderr: 'pipe',
		});
		const [status, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
		if ((await proc.exited) !== 0) throw new Error(stderr.trim() || 'curl-impersonate exited non-zero');
		return new Response(fs.readFileSync(out), { status: Number(status) || 502 });
	} finally {
		fs.rmSync(out, { force: true });
	}
}
