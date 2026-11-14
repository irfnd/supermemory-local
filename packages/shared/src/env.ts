export type Env = Record<string, string | undefined>;

export function requireEnv(env: Env, key: string): string {
	const value = env[key]?.trim();
	if (!value) throw new Error(`${key} is not set`);
	return value;
}

export const trimTrailingSlash = (url: string) => url.replace(/\/$/, '');
