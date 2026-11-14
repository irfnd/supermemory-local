export interface Handler {
	handle(req: Request): Promise<Response>;
}

export interface ListenConfig {
	bindHost: string;
	port: number;
}

export function listen(handler: Handler, { bindHost, port }: ListenConfig) {
	// idleTimeout 0: upstream LLM calls take up to ~110s, Bun's 10s default would cut them
	return Bun.serve({ hostname: bindHost, port, idleTimeout: 0, fetch: (req) => handler.handle(req) });
}
