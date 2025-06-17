let SaxonJS;
try {
  const saxonModule = await import('saxon-js');
  SaxonJS = saxonModule.default || saxonModule;

  // Ensure SaxonJS is properly initialized
  if (typeof SaxonJS.transform === 'undefined') {
    throw new Error('Saxon-JS not properly loaded');
  }

  globalThis.SaxonJS = SaxonJS;
} catch (error) {
  console.error('Failed to load Saxon-JS:', error);
  throw new Error('Saxon-JS initialization failed');
}

export * from './converter/package-converter';
export * from './converter/converter';
