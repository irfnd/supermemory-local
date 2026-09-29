// Project Resolver: determines project root and unique container tag
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface Project {
	projectName: string;
	sanitizedName: string;
	rootDir: string;
	containerTag: string;
}

/**
 * Resolves project root and metadata from an input directory or process.cwd()
 */
export function resolveProject(candidateDir?: string): Project {
	let cwd = candidateDir || process.cwd();

	// If candidateDir is a file, use its directory
	try {
		if (fs.statSync(cwd).isFile()) cwd = path.dirname(cwd);
	} catch {}

	// Git root, falling back to cwd outside a repository
	let rootDir = cwd;
	try {
		const git = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel'], {
			cwd,
			stderr: 'ignore',
		});
		const gitRoot = git.stdout.toString().trim();
		if (git.success && gitRoot && fs.existsSync(gitRoot)) rootDir = gitRoot;
	} catch {}

	// Canonical realpath
	try {
		rootDir = fs.realpathSync(rootDir);
	} catch {}

	const projectName = path.basename(rootDir) || 'default-project';
	const sanitizedName = projectName.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();

	// Short path hash to disambiguate identical folder names
	const pathHash = crypto.createHash('sha256').update(rootDir).digest('hex').slice(0, 6);

	return {
		projectName,
		sanitizedName,
		rootDir,
		containerTag: `proj_${sanitizedName}_${pathHash}`,
	};
}
