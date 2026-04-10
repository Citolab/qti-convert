export type BinaryInput = File | Blob | ArrayBuffer | Uint8Array;
export type SpreadsheetInput = BinaryInput | string;

export const getInputFileName = (
  input: BinaryInput | SpreadsheetInput,
  fallback?: string
): string | undefined => {
  if (fallback) {
    return fallback;
  }
  if (typeof File !== 'undefined' && input instanceof File) {
    return input.name;
  }
  return undefined;
};

export const toArrayBuffer = async (input: SpreadsheetInput): Promise<ArrayBuffer> => {
  if (typeof input === 'string') {
    return new Uint8Array(new TextEncoder().encode(input)).buffer.slice(0) as ArrayBuffer;
  }
  if (input instanceof ArrayBuffer) {
    return input;
  }
  if (input instanceof Uint8Array) {
    return new Uint8Array(input).buffer.slice(0) as ArrayBuffer;
  }
  return input.arrayBuffer();
};
