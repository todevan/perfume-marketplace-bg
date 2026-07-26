import type { RequestHandler } from './$types';

export const GET: RequestHandler = () =>
  new Response('User-agent: *\nDisallow: /\n', {
    headers: {
      'cache-control': 'public, max-age=300',
      'content-type': 'text/plain; charset=utf-8',
      'x-robots-tag': 'noindex, nofollow'
    }
  });
