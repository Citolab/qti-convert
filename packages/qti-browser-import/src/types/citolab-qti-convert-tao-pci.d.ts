declare module '@citolab/qti-convert-tao-pci' {
  export type ProcessedType = 'test' | 'item' | 'manifest' | 'other';

  export type ProcessedFile = {
    content: string | BlobPart;
    type: ProcessedType;
  };

  export type ProcessedMap = Map<string, ProcessedFile>;

  export function convert(processedFiles: ProcessedMap): Promise<ProcessedMap>;
}
