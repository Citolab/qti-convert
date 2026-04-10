/**
 * Cloudflare Worker CORS Proxy for qti-convert-local-ai
 * 
 * Deploy this worker to enable fetching Google Forms, Microsoft Forms,
 * and other remote sources from the browser.
 * 
 * Usage:
 * 1. Create a Cloudflare account (free tier works)
 * 2. Go to Workers & Pages → Create Worker
 * 3. Paste this code and deploy
 * 4. Use your worker URL:
 *    
 *    convertRemoteSourceToQtiPackage(url, {
 *      proxyUrl: 'https://your-worker.your-subdomain.workers.dev?url={url}'
 *    });
 */

export default {
  async fetch(request) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Max-Age': '86400',
        }
      });
    }

    // Only allow GET requests
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405 });
    }

    // Get target URL from query parameter
    const requestUrl = new URL(request.url);
    const targetUrl = requestUrl.searchParams.get('url');

    if (!targetUrl) {
      return new Response('Missing "url" query parameter', { status: 400 });
    }

    // Validate URL
    let parsedUrl;
    try {
      parsedUrl = new URL(targetUrl);
    } catch {
      return new Response('Invalid URL', { status: 400 });
    }

    // Optional: Restrict to specific domains for security
    // const allowedDomains = ['docs.google.com', 'forms.google.com', 'forms.gle', 'forms.office.com'];
    // if (!allowedDomains.some(d => parsedUrl.hostname.endsWith(d))) {
    //   return new Response('Domain not allowed', { status: 403 });
    // }

    try {
      // Fetch the target URL with browser-like headers
      const response = await fetch(targetUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
        },
        redirect: 'follow',
      });

      // Get response body as ArrayBuffer to handle binary content
      const body = await response.arrayBuffer();

      // Preserve important response headers
      const contentType = response.headers.get('Content-Type') || 'application/octet-stream';
      const contentDisposition = response.headers.get('Content-Disposition');

      const responseHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Content-Type, Content-Disposition, Content-Length',
        'Content-Type': contentType,
      };

      if (contentDisposition) {
        responseHeaders['Content-Disposition'] = contentDisposition;
      }

      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      return new Response(`Proxy error: ${error.message}`, { status: 502 });
    }
  }
};
