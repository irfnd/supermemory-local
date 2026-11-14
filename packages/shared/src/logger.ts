import fs from 'node:fs';
import { token } from '@supermemory-local/shared/di';

export interface Logger {
	info(message: string): void;
}

export const LOGGER = token<Logger>('Logger');

export class ConsoleLogger implements Logger {
	constructor(private readonly timestamps = true) {}

	info(message: string) {
		console.log(this.timestamps ? `${new Date().toISOString()} ${message}` : message);
	}
}

export class FileLogger implements Logger {
	constructor(private readonly file: string) {}

	info(message: string) {
		try {
			fs.appendFileSync(this.file, `[${new Date().toISOString()}] ${message}\n`);
		} catch {}
	}
}
