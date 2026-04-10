/* @vitest-environment jsdom */

import { describe, expect, test } from 'vitest';
import {
  DEFAULT_REMOTE_SOURCE_PROXY_URL,
  convertRemoteSourceToQtiPackage,
  inferRemoteSourceRoute
} from '../src/converters';

const GOOGLE_FORM_HTML = `<!DOCTYPE html>
<html>
  <body>
    <script>
      FB_PUBLIC_LOAD_DATA_ = [null,[
        "Description",
        [
          ["q1","Pick one fruit","",2,[[111,[["Apple"],["Banana"]],1]],null,null,null]
        ],
        null,null,null,null,null,null,
        "Knowledge Check"
      ],null,"knowledge-check-form"];
    </script>
  </body>
</html>`;

describe('remote source routing', () => {
  test('routes Google Sheets links to xlsx export', () => {
    const route = inferRemoteSourceRoute('https://docs.google.com/spreadsheets/d/abc123/edit#gid=0');

    expect(route).toMatchObject({
      mode: 'xlsx',
      fetchUrl: 'https://docs.google.com/spreadsheets/d/abc123/export?format=xlsx'
    });
  });

  test('routes Google Docs links to docx export', () => {
    const route = inferRemoteSourceRoute('https://docs.google.com/document/d/doc456/edit');

    expect(route).toMatchObject({
      mode: 'docx',
      fetchUrl: 'https://docs.google.com/document/d/doc456/export?format=docx'
    });
  });

  test('routes Google Forms links to google-form processing', () => {
    const route = inferRemoteSourceRoute('https://docs.google.com/forms/d/e/1FAIpQLSf/viewform');

    expect(route).toMatchObject({
      mode: 'google-form'
    });
  });

  test('routes Microsoft Forms links to microsoft-form processing', () => {
    const route = inferRemoteSourceRoute('https://forms.office.com/r/example');

    expect(route).toMatchObject({
      mode: 'microsoft-form'
    });
  });

  test('uses the default proxy when proxyUrl is omitted', async () => {
    let requestedUrl = '';

    await convertRemoteSourceToQtiPackage('https://docs.google.com/forms/d/e/1FAIpQLSf/viewform', {
      fetchRemote: async url => {
        requestedUrl = url;
        return new Response(GOOGLE_FORM_HTML, {
          status: 200,
          headers: {
            'content-type': 'text/html'
          }
        });
      }
    });

    expect(requestedUrl).toBe('https://corsproxy.io/?url=https%3A%2F%2Fdocs.google.com%2Fforms%2Fd%2Fe%2F1FAIpQLSf%2Fviewform');
    expect(DEFAULT_REMOTE_SOURCE_PROXY_URL).toBe('https://corsproxy.io/?url={url}');
  });

  test('allows disabling the default proxy by passing an empty proxyUrl', async () => {
    let requestedUrl = '';

    await convertRemoteSourceToQtiPackage('https://docs.google.com/forms/d/e/1FAIpQLSf/viewform', {
      proxyUrl: '',
      fetchRemote: async url => {
        requestedUrl = url;
        return new Response(GOOGLE_FORM_HTML, {
          status: 200,
          headers: {
            'content-type': 'text/html'
          }
        });
      }
    });

    expect(requestedUrl).toBe('https://docs.google.com/forms/d/e/1FAIpQLSf/viewform');
  });
});
