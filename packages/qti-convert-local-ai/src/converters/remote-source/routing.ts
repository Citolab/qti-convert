import type { RemoteSourceMode, RemoteSourceRoute } from './types';

export const DEFAULT_REMOTE_SOURCE_PROXY_URL = 'https://corsproxy.io/?url={url}';

const tryParseUrl = (rawUrl: string): URL | null => {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
};

export const getFileExtension = (fileName: string): string => {
  const match = fileName.toLowerCase().match(/\.[^.]+$/);
  return match?.[0] || '';
};

export const getFileBaseName = (fileName: string): string => fileName.replace(/\.[^.]+$/i, '');

export const normalizeHtmlToText = (html: string): string => {
  if (typeof DOMParser === 'undefined') {
    return html
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const document = new DOMParser().parseFromString(html, 'text/html');
  return document.body.textContent?.replace(/\s+/g, ' ').trim() || '';
};

const buildGoogleExportRoute = (url: URL): RemoteSourceRoute | null => {
  const spreadsheetMatch = url.pathname.match(/^\/spreadsheets\/d\/([^/]+)/);
  if (spreadsheetMatch) {
    const id = spreadsheetMatch[1];
    return {
      fetchUrl: `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`,
      mode: 'xlsx',
      fileName: `${id}.xlsx`,
      originalUrl: url.toString()
    };
  }

  const documentMatch = url.pathname.match(/^\/document\/d\/([^/]+)/);
  if (documentMatch) {
    const id = documentMatch[1];
    return {
      fetchUrl: `https://docs.google.com/document/d/${id}/export?format=docx`,
      mode: 'docx',
      fileName: `${id}.docx`,
      originalUrl: url.toString()
    };
  }

  if (url.pathname.includes('/forms/')) {
    return {
      fetchUrl: url.toString(),
      mode: 'google-form',
      fileName: 'google-form',
      originalUrl: url.toString()
    };
  }

  return null;
};

export const inferRemoteSourceRoute = (rawUrl: string): RemoteSourceRoute | null => {
  const url = tryParseUrl(rawUrl.trim());
  if (!url) {
    return null;
  }

  if (url.hostname === 'docs.google.com') {
    return buildGoogleExportRoute(url);
  }

  if (url.hostname === 'forms.gle' || (url.hostname.endsWith('.google.com') && url.pathname.includes('/forms/'))) {
    return {
      fetchUrl: url.toString(),
      mode: 'google-form',
      fileName: 'google-form',
      originalUrl: url.toString()
    };
  }

  if (url.hostname === 'forms.office.com' || url.hostname.endsWith('.forms.office.com')) {
    return {
      fetchUrl: url.toString(),
      mode: 'microsoft-form',
      fileName: 'microsoft-form',
      originalUrl: url.toString()
    };
  }

  const extension = getFileExtension(url.pathname);
  if (extension === '.xlsx' || extension === '.xls') {
    return {
      fetchUrl: url.toString(),
      mode: 'xlsx',
      fileName: decodeURIComponent(url.pathname.split('/').pop() || 'remote.xlsx'),
      originalUrl: url.toString()
    };
  }
  if (extension === '.docx') {
    return {
      fetchUrl: url.toString(),
      mode: 'docx',
      fileName: decodeURIComponent(url.pathname.split('/').pop() || 'remote.docx'),
      originalUrl: url.toString()
    };
  }
  if (extension === '.pdf') {
    return {
      fetchUrl: url.toString(),
      mode: 'pdf',
      fileName: decodeURIComponent(url.pathname.split('/').pop() || 'remote.pdf'),
      originalUrl: url.toString()
    };
  }
  if (extension === '.csv') {
    return {
      fetchUrl: url.toString(),
      mode: 'csv',
      fileName: decodeURIComponent(url.pathname.split('/').pop() || 'remote.csv'),
      originalUrl: url.toString()
    };
  }

  return {
    fetchUrl: url.toString(),
    mode: 'html-text',
    fileName: decodeURIComponent(url.pathname.split('/').pop() || 'remote-source.txt'),
    originalUrl: url.toString()
  };
};

export const buildProxyRequestUrl = (targetUrl: string, proxyUrl?: string): string => {
  const effectiveProxyUrl = proxyUrl === undefined ? DEFAULT_REMOTE_SOURCE_PROXY_URL : proxyUrl;
  const trimmedProxy = effectiveProxyUrl.trim();
  if (!trimmedProxy) {
    return targetUrl;
  }

  if (trimmedProxy.includes('{url}')) {
    return trimmedProxy.replace('{url}', encodeURIComponent(targetUrl));
  }

  const url = new URL(trimmedProxy);
  url.searchParams.set('url', targetUrl);
  return url.toString();
};

export const inferResponseMode = (contentType: string, fileName: string): RemoteSourceMode | null => {
  const extension = getFileExtension(fileName);
  if (extension === '.xlsx' || extension === '.xls') {
    return 'xlsx';
  }
  if (extension === '.docx') {
    return 'docx';
  }
  if (extension === '.pdf') {
    return 'pdf';
  }
  if (extension === '.csv') {
    return 'csv';
  }

  if (contentType.includes('spreadsheet') || contentType.includes('excel')) {
    return 'xlsx';
  }
  if (contentType.includes('wordprocessingml') || contentType.includes('msword')) {
    return 'docx';
  }
  if (contentType.includes('pdf')) {
    return 'pdf';
  }
  if (contentType.includes('csv')) {
    return 'csv';
  }
  if (contentType.includes('html') || contentType.startsWith('text/')) {
    return 'html-text';
  }

  return null;
};
