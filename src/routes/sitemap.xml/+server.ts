import type { RequestHandler } from './$types';
import { demoListings } from '$lib/data/demo';
import { env } from '$env/dynamic/public';

const staticRoutes = ['/', '/listings', '/wanted', '/merchants', '/safety'];

export const GET: RequestHandler = ({ url }) => {
  if (env.PUBLIC_DEMO_MODE !== 'true') {
    return new Response(null, {
      status: 404,
      headers: { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow' }
    });
  }

  const locations = [
    ...staticRoutes,
    ...demoListings.map((listing) => `/listing/${listing.slug}`),
    ...demoListings.map((listing) => `/perfume/${listing.slug}`)
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${locations.map((path) => `  <url><loc>${new URL(path, url.origin).href}</loc></url>`).join('\n')}
</urlset>`;

  return new Response(body, {
    headers: {
      'cache-control': 'private, no-store',
      'x-robots-tag': 'noindex, nofollow',
      'content-type': 'application/xml; charset=utf-8'
    }
  });
};
