export function removeDoubleSlashes(str: string) {
  const singleForwardSlashes = str
    .replace(/([^:]\/)\/+/g, '$1')
    .replace(/\/\//g, '/')
    .replace('http:/', 'http://')
    .replace('https:/', 'https://');
  return singleForwardSlashes;
}
