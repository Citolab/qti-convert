import ExcelJS from 'exceljs';
import { createWebLlmEngine } from './mapping';
import { convertSpreadsheetToQtiPackage } from './convert-spreadsheet';
import { convertDocxToQtiPackage } from './docx-parser';
import { convertPdfToQtiPackage } from './pdf-parser';
import { convertGoogleFormToQtiPackage } from './google-form';
import { convertMicrosoftFormToQtiPackage } from './microsoft-form';
import { GenerateQtiPackageOptions, SpreadsheetToQtiResult } from './types';

export type RemoteSourceMode = 'xlsx' | 'docx' | 'pdf' | 'csv' | 'html-text' | 'google-form' | 'microsoft-form';

export type RemoteSourceRoute = {
  fetchUrl: string;
  mode: RemoteSourceMode;
  fileName: string;
  originalUrl: string;
};

export type RemoteSourceFetcher = (url: string, init?: RequestInit) => Promise<Response>;

export type ConvertRemoteSourceToQtiOptions = GenerateQtiPackageOptions & {
  fetchRemote?: RemoteSourceFetcher;
  proxyUrl?: string;
};

export type RemoteSourceToQtiResult = Pick<
  SpreadsheetToQtiResult,
  'questions' | 'packageBlob' | 'packageName' | 'summary'
> & {
  sourceMode: RemoteSourceMode;
  resolvedUrl: string;
  fileName: string;
};

/**
 * Default CORS proxy URL. Uses {url} placeholder for the target URL.
 *
 * To use your own Cloudflare Worker proxy, see the cloudflare-cors-proxy
 * directory in this package for a ready-to-deploy worker.
 *
 * Usage: proxyUrl: 'https://your-worker.workers.dev?url={url}'
 */
export const DEFAULT_REMOTE_SOURCE_PROXY_URL = 'https://corsproxy.io/?url={url}';

const tryParseUrl = (rawUrl: string): URL | null => {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
};

const getFileExtension = (fileName: string): string => {
  const match = fileName.toLowerCase().match(/\.[^.]+$/);
  return match?.[0] || '';
};

const getFileBaseName = (fileName: string): string => fileName.replace(/\.[^.]+$/i, '');

const normalizeHtmlToText = (html: string): string => {
  if (typeof DOMParser === 'undefined') {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
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

const buildProxyRequestUrl = (targetUrl: string, proxyUrl?: string): string => {
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

const getResponseFileName = (response: Response, fallback: string): string => {
  const contentDisposition = response.headers.get('content-disposition') || '';
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  const plainMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
  return decodeURIComponent(utf8Match?.[1] || plainMatch?.[1] || fallback);
};

const defaultFetchRemote: RemoteSourceFetcher = (url, init) =>
  fetch(url, {
    method: 'GET',
    credentials: 'omit',
    ...init
  });

const responseContentToString = async (response: Response): Promise<string> => await response.text();

const inferResponseMode = (contentType: string, fileName: string): RemoteSourceMode | null => {
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

const chooseAmbiguousMode = async (
  url: string,
  contentType: string,
  preview: string,
  options: ConvertRemoteSourceToQtiOptions
): Promise<RemoteSourceMode | null> => {
  try {
    const engine = await createWebLlmEngine(options.llmSettings);
    const response = await engine.chat.completions.create({
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Return JSON only with a single key "mode". Choose the best processing mode for this remote assessment source. Allowed values: "xlsx", "docx", "pdf", "csv", "html-text". Prefer deterministic document formats when they are clearly available. Use "html-text" for generic form pages or HTML content.'
        },
        {
          role: 'user',
          content: JSON.stringify({
            url,
            contentType,
            preview: preview.slice(0, 4000)
          })
        }
      ]
    });

    const rawContent = response.choices?.[0]?.message?.content;
    const content =
      typeof rawContent === 'string'
        ? rawContent
        : Array.isArray(rawContent)
          ? rawContent.map(part => part.text || '').join('')
          : '';

    const parsed = JSON.parse(content) as { mode?: RemoteSourceMode };
    return parsed.mode || null;
  } catch {
    return null;
  }
};

const createWorkbookFileFromText = async (text: string, fileName: string): Promise<File> => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  sheet.addRow(['text']);
  sheet.addRow([text]);
  const workbookBytes = await workbook.xlsx.writeBuffer();
  return new File([workbookBytes], `${getFileBaseName(fileName)}.xlsx`, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
};

const convertFetchedSource = async (
  route: RemoteSourceRoute,
  response: Response,
  options: ConvertRemoteSourceToQtiOptions
): Promise<RemoteSourceToQtiResult> => {
  const responseFileName = getResponseFileName(response, route.fileName);
  const contentType = response.headers.get('content-type')?.toLowerCase() || '';

  if (route.mode === 'google-form') {
    const result = await convertGoogleFormToQtiPackage(route.fetchUrl, {
      ...options,
      fetchFormHtml: async (url: string) => {
        const htmlResponse = await (options.fetchRemote || defaultFetchRemote)(buildProxyRequestUrl(url, options.proxyUrl));
        if (!htmlResponse.ok) {
          throw new Error(`Failed to fetch Google Form (${htmlResponse.status}).`);
        }
        return responseContentToString(htmlResponse);
      }
    });
    return {
      ...result,
      sourceMode: 'google-form',
      resolvedUrl: route.fetchUrl,
      fileName: responseFileName
    };
  }

  if (route.mode === 'microsoft-form') {
    const html = await responseContentToString(response);
    const result = await convertMicrosoftFormToQtiPackage(html, {
      ...options,
      fetchRuntimeForm: async (url: string, init?: RequestInit) => {
        const runtimeResponse = await (options.fetchRemote || defaultFetchRemote)(buildProxyRequestUrl(url, options.proxyUrl), init);
        if (!runtimeResponse.ok) {
          throw new Error(`Failed to fetch Microsoft Form definition (${runtimeResponse.status}).`);
        }
        return responseContentToString(runtimeResponse);
      }
    });
    return {
      ...result,
      sourceMode: 'microsoft-form',
      resolvedUrl: route.fetchUrl,
      fileName: responseFileName
    };
  }

  const deterministicMode = route.mode !== 'html-text' ? route.mode : inferResponseMode(contentType, responseFileName);

  if (deterministicMode === 'xlsx' || deterministicMode === 'csv') {
    const blob = await response.blob();
    const file = new File([blob], responseFileName || `remote.${deterministicMode}`, { type: blob.type || undefined });
    const result = await convertSpreadsheetToQtiPackage(file, options);
    return {
      questions: result.questions,
      packageBlob: result.packageBlob,
      packageName: result.packageName,
      summary: result.summary,
      sourceMode: deterministicMode,
      resolvedUrl: route.fetchUrl,
      fileName: file.name
    };
  }

  if (deterministicMode === 'docx') {
    const blob = await response.blob();
    const file = new File([blob], responseFileName || 'remote.docx', { type: blob.type || undefined });
    const result = await convertDocxToQtiPackage(file, options);
    return {
      questions: result.questions,
      packageBlob: result.packageBlob,
      packageName: result.packageName,
      summary: result.summary,
      sourceMode: 'docx',
      resolvedUrl: route.fetchUrl,
      fileName: file.name
    };
  }

  if (deterministicMode === 'pdf') {
    const blob = await response.blob();
    const file = new File([blob], responseFileName || 'remote.pdf', { type: blob.type || undefined });
    const result = await convertPdfToQtiPackage(file, options);
    return {
      questions: result.questions,
      packageBlob: result.packageBlob,
      packageName: result.packageName,
      summary: result.summary,
      sourceMode: 'pdf',
      resolvedUrl: route.fetchUrl,
      fileName: file.name
    };
  }

  const rawText = await responseContentToString(response);
  const normalizedText =
    contentType.includes('html') || rawText.includes('<html') || rawText.includes('<!DOCTYPE html')
      ? normalizeHtmlToText(rawText)
      : rawText.trim();

  if (!normalizedText) {
    throw new Error('The remote source returned no usable content.');
  }

  const inferredMode = await chooseAmbiguousMode(route.fetchUrl, contentType, normalizedText, options);
  if (inferredMode && inferredMode !== 'html-text') {
    throw new Error(`Remote source was classified as "${inferredMode}", but only HTML/text processing is available for this response.`);
  }

  const workbookFile = await createWorkbookFileFromText(normalizedText, responseFileName || route.fileName);
  const result = await convertSpreadsheetToQtiPackage(workbookFile, options);
  return {
    questions: result.questions,
    packageBlob: result.packageBlob,
    packageName: result.packageName,
    summary: result.summary,
    sourceMode: 'html-text',
    resolvedUrl: route.fetchUrl,
    fileName: workbookFile.name
  };
};

export const convertRemoteSourceToQtiPackage = async (
  rawUrl: string,
  options: ConvertRemoteSourceToQtiOptions = {}
): Promise<RemoteSourceToQtiResult> => {
  const route = inferRemoteSourceRoute(rawUrl);
  if (!route) {
    throw new Error('Unsupported or invalid remote source URL.');
  }

  if (route.mode === 'google-form') {
    const result = await convertGoogleFormToQtiPackage(route.fetchUrl, {
      ...options,
      fetchFormHtml: async (url: string) => {
        const response = await (options.fetchRemote || defaultFetchRemote)(buildProxyRequestUrl(url, options.proxyUrl));
        if (!response.ok) {
          throw new Error(`Failed to fetch Google Form (${response.status}).`);
        }
        return responseContentToString(response);
      }
    });
    return {
      ...result,
      sourceMode: 'google-form',
      resolvedUrl: route.fetchUrl,
      fileName: route.fileName
    };
  }

  const response = await (options.fetchRemote || defaultFetchRemote)(buildProxyRequestUrl(route.fetchUrl, options.proxyUrl));
  if (!response.ok) {
    throw new Error(`Failed to fetch remote source (${response.status}).`);
  }

  return convertFetchedSource(route, response, options);
};
