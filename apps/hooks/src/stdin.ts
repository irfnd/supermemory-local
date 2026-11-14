const STDIN_TIMEOUT_MS = 2000;

export async function readStdin(): Promise<string> {
	if (process.stdin.isTTY) return '';
	// unref: a pending timer must not keep the process alive once stdin is read
	const timeout = new Promise<string>((resolve) => setTimeout(() => resolve(''), STDIN_TIMEOUT_MS).unref());
	return (await Promise.race([Bun.stdin.text(), timeout])).trim();
}
