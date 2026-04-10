# Cloudflare CORS Proxy for qti-convert-local-ai

A simple CORS proxy worker that enables fetching Google Forms, Microsoft Forms, and other remote sources from the browser.

## Deployment

### Option 1: Cloudflare Dashboard (Easiest)

1. Create a [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
2. Go to **Workers & Pages** → **Create Worker**
3. Copy the contents of `worker.js` and paste it
4. Click **Deploy**
5. Your worker URL will be: `https://your-worker.your-subdomain.workers.dev`

### Option 2: Wrangler CLI

```bash
# Install wrangler
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Deploy from this directory
cd cloudflare-cors-proxy
wrangler deploy
```

## Usage

```typescript
import { convertRemoteSourceToQtiPackage } from '@citolab/qti-convert-local-ai';

const result = await convertRemoteSourceToQtiPackage(googleFormUrl, {
  proxyUrl: 'https://your-worker.your-subdomain.workers.dev?url={url}'
});
```

## Security Considerations

For production use, consider:

1. **Domain restrictions**: Uncomment the `allowedDomains` block in `worker.js` to restrict which URLs can be proxied
2. **Rate limiting**: Add Cloudflare rate limiting rules
3. **Custom domain**: Use a custom domain instead of the default workers.dev subdomain

## Free Tier Limits

Cloudflare Workers free tier includes:
- 100,000 requests/day
- 10ms CPU time per request
- No cold starts

This is more than sufficient for typical usage of qti-convert.
