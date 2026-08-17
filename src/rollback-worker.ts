export default {
	fetch(_request: Request, environment: { ROLLBACK_SOURCE_GIT_SHA?: string }): Response {
		const sourceSha = environment.ROLLBACK_SOURCE_GIT_SHA?.trim() ?? '';
		if (!/^[0-9a-f]{40}$/u.test(sourceSha)) {
			return new Response('Rollback artifact is not attributable.', { status: 503 });
		}
		return new Response('Authentication service is unavailable.', {
			status: 503,
			headers: {
				'cache-control': 'no-store',
				'content-security-policy': "default-src 'none'; frame-ancestors 'none'; object-src 'none'",
				'permissions-policy': 'camera=(), geolocation=(), microphone=(), payment=()',
				'referrer-policy': 'no-referrer',
				'retry-after': '60',
				'x-content-type-options': 'nosniff',
				'x-frame-options': 'DENY',
				'x-request-id': crypto.randomUUID(),
				'x-deployed-git-sha': sourceSha
			}
		});
	}
};
