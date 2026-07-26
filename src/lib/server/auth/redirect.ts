const DEFAULT_DESTINATION = '/dashboard';

/** Only same-origin absolute paths are accepted. Backslashes and protocol-relative paths are rejected. */
export function safeRedirectPath(value: string | null | undefined, fallback = DEFAULT_DESTINATION): string {
	if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;

	try {
		const parsed = new URL(value, 'https://redirect.invalid');
		if (parsed.origin !== 'https://redirect.invalid') return fallback;
		return `${parsed.pathname}${parsed.search}${parsed.hash}`;
	} catch {
		return fallback;
	}
}

export function loginRedirect(url: URL): string {
	const destination = `${url.pathname}${url.search}`;
	return `/login?next=${encodeURIComponent(safeRedirectPath(destination, '/'))}`;
}

