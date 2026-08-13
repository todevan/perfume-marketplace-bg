import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { chmod, open, rename, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export class HostedPrivateFileError extends Error {
	/** @param {string} message */
	constructor(message) {
		super(message);
		this.name = 'HostedPrivateFileError';
	}
}

/** @param {string} candidate @param {string} root */
function pathIsInside(candidate, root) {
	const rootRelative = relative(root, candidate);
	return rootRelative === '' || (!rootRelative.startsWith('..') && !isAbsolute(rootRelative));
}

/** @param {string} filePath @param {{ extension: string }} options */
export function resolveOutsideRepositoryFile(filePath, { extension }) {
	if (typeof filePath !== 'string' || !isAbsolute(filePath) || !filePath.endsWith(extension)) {
		throw new HostedPrivateFileError('private file path is invalid');
	}
	const absolutePath = resolve(filePath);
	let realParent;
	try {
		realParent = realpathSync(dirname(absolutePath));
		let existing = null;
		try {
			existing = lstatSync(absolutePath);
		} catch (error) {
			if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
		}
		if (existing?.isSymbolicLink()) throw new Error('symbolic link');
	} catch {
		throw new HostedPrivateFileError('private file path is invalid');
	}
	const realPath = resolve(realParent, basename(absolutePath));
	if (pathIsInside(realPath, realpathSync(REPOSITORY_ROOT))) {
		throw new HostedPrivateFileError('private file must remain outside the repository');
	}
	return realPath;
}

/** @param {string} filePath */
async function restrictFileAccess(filePath) {
	try {
		await chmod(filePath, 0o600);
		if (process.platform === 'win32') {
			const username = process.env.USERNAME;
			if (!username) throw new Error('missing Windows identity');
			const identity = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${username}` : username;
			await execFileAsync('icacls.exe', [filePath, '/inheritance:r'], { windowsHide: true });
			await execFileAsync('icacls.exe', [filePath, '/grant:r', `${identity}:(F)`], {
				windowsHide: true
			});
		}
	} catch {
		throw new HostedPrivateFileError('private file permissions failed');
	}
}

/** @param {string} filePath @param {string} contents */
export async function atomicPrivateWrite(filePath, contents) {
	const temporaryPath = resolve(
		dirname(filePath),
		`.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
	);
	let handle;
	try {
		handle = await open(temporaryPath, 'wx', 0o600);
		await handle.writeFile(contents, 'utf8');
		await handle.sync();
		await handle.close();
		handle = undefined;
		await restrictFileAccess(temporaryPath);
		await rename(temporaryPath, filePath);
		await restrictFileAccess(filePath);
	} catch (error) {
		try {
			await handle?.close();
		} catch {
			// The caller receives a single sanitized private-file error.
		}
		try {
			await unlink(temporaryPath);
		} catch {
			// The temporary file may already have been atomically renamed.
		}
		if (error instanceof HostedPrivateFileError) throw error;
		throw new HostedPrivateFileError('private file write failed');
	}
}

/**
 * Create the final private file itself with exclusive-create semantics. This is
 * used to reserve a run ledger before any hosted mutation can begin.
 *
 * @param {string} filePath @param {string} contents
 */
export async function reservePrivateFile(filePath, contents) {
	let handle;
	let created = false;
	try {
		handle = await open(filePath, 'wx', 0o600);
		created = true;
		await handle.writeFile(contents, 'utf8');
		await handle.sync();
		await handle.close();
		handle = undefined;
		await restrictFileAccess(filePath);
	} catch (error) {
		try {
			await handle?.close();
		} catch {
			// The caller receives a single sanitized private-file error.
		}
		if (created) {
			try {
				await unlink(filePath);
			} catch {
				// A failed reservation remains fail-closed as an occupied path.
			}
		}
		if (/** @type {NodeJS.ErrnoException} */ (error).code === 'EEXIST') {
			throw new HostedPrivateFileError('private file already exists');
		}
		if (error instanceof HostedPrivateFileError) throw error;
		throw new HostedPrivateFileError('private file reservation failed');
	}
}
