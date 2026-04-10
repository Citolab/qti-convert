import ExcelJS from 'exceljs';
import { createWebLlmEngine } from '../../mapping';
import { convertSpreadsheetToQtiPackage } from '../spreadsheet';
import { convertDocxToQtiPackage } from '../docx';
import { convertPdfToQtiPackage } from '../pdf';
import { convertGoogleFormToQtiPackage } from '../google-form';
import { convertMicrosoftFormToQtiPackage } from '../microsoft-form';
import type {
  ConvertRemoteSourceToQtiOptions,
  RemoteSourceFetcher,
  RemoteSourceMode,
  RemoteSourceRoute,
  RemoteSourceToQtiResult
} from './types';
import {
  buildProxyRequestUrl,
  getFileBaseName,
  getFileExtension,
  inferRemoteSourceRoute,
  inferResponseMode,
  normalizeHtmlToText
} from './routing';

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
        const htmlResponse = await (options.fetchRemote || defaultFetchRemote)(
          buildProxyRequestUrl(url, options.proxyUrl)
        );
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
        const runtimeResponse = await (options.fetchRemote || defaultFetchRemote)(
          buildProxyRequestUrl(url, options.proxyUrl),
          init
        );
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
    throw new Error(
      `Remote source was classified as "${inferredMode}", but only HTML/text processing is available for this response.`
    );
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

  const response = await (options.fetchRemote || defaultFetchRemote)(
    buildProxyRequestUrl(route.fetchUrl, options.proxyUrl)
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch remote source (${response.status}).`);
  }

  return convertFetchedSource(route, response, options);
};
