import type { GenerateQtiPackageOptions, SpreadsheetToQtiResult } from '../../types';

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
