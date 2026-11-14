import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface Project {
	projectName: string;
	sanitizedName: string;
	rootDir: string;
	containerTag: string;
}

export class ProjectResolver {
	resolve(candidateDir?: string): Project {
		const rootDir = this.canonical(this.gitRoot(this.directoryOf(candidateDir || process.cwd())));
		const projectName = path.basename(rootDir) || 'default-project';
		const sanitizedName = projectName.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
		const pathHash = crypto.createHash('sha256').update(rootDir).digest('hex').slice(0, 6);
		return { projectName, sanitizedName, rootDir, containerTag: `proj_${sanitizedName}_${pathHash}` };
	}

	private directoryOf(candidate: string): string {
		try {
			return fs.statSync(candidate).isFile() ? path.dirname(candidate) : candidate;
		} catch {
			return candidate;
		}
	}

	private gitRoot(cwd: string): string {
		try {
			const git = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel'], { cwd, stderr: 'ignore' });
			const root = git.stdout.toString().trim();
			return git.success && root && fs.existsSync(root) ? root : cwd;
		} catch {
			return cwd;
		}
	}

	private canonical(dir: string): string {
		try {
			return fs.realpathSync(dir);
		} catch {
			return dir;
		}
	}
}
