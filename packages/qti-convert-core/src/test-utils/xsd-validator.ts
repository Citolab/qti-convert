// Test helper: validates XML against the official QTI XSDs with xmllint. The schemas are downloaded once and
// cached; imported MathML/SSML/XInclude/APIP schemas are replaced by lax stubs, so the QTI part is checked
// strictly. Node only, for tests.
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';

const CACHE_DIR = path.join(os.tmpdir(), 'qti-convert-xsd-cache');
const XML_XSD_URL = 'https://www.w3.org/2001/xml.xsd';

const LAX_NAMESPACES = [
  'http://www.w3.org/1998/Math/MathML',
  'http://www.w3.org/2001/XInclude',
  'http://www.w3.org/2001/10/synthesis',
  'http://www.imsglobal.org/xsd/apip/apipv1p0/imsapip_qtiv1p0'
];

export const hasXmllint = (() => {
  try {
    execFileSync('xmllint', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const laxSchema = (namespace: string, elements: string[]) => `<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="${namespace}" elementFormDefault="qualified">
${elements
  .map(
    name =>
      `  <xs:element name="${name}"><xs:complexType mixed="true"><xs:sequence><xs:any processContents="skip" minOccurs="0" maxOccurs="unbounded"/></xs:sequence><xs:anyAttribute processContents="skip"/></xs:complexType></xs:element>`
  )
  .join('\n')}
</xs:schema>`;

const download = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.text();
};

/**
 * Downloads (once) and prepares a local copy of a QTI XSD. Returns the local schema path,
 * or null when it could not be downloaded.
 */
export const prepareQtiSchema = async (name: string, url: string): Promise<string | null> => {
  const schemaPath = path.join(CACHE_DIR, `${name}-local.xsd`);
  if (existsSync(schemaPath)) return schemaPath;
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    let schema = await download(url);
    if (!existsSync(path.join(CACHE_DIR, 'xml.xsd'))) writeFileSync(path.join(CACHE_DIR, 'xml.xsd'), await download(XML_XSD_URL));

    for (const match of schema.matchAll(/<xs:import\s+namespace="([^"]+)"\s+schemaLocation="([^"]+)"\s*\/>/g)) {
      const [, namespace, location] = match;
      if (namespace === 'http://www.w3.org/XML/1998/namespace') {
        schema = schema.replace(location, 'xml.xsd');
      } else if (LAX_NAMESPACES.includes(namespace)) {
        // stub every element the QTI schema references in this namespace
        const prefixes = [...schema.matchAll(/xmlns:([\w-]+)="([^"]+)"/g)].filter(m => m[2] === namespace).map(m => m[1]);
        const elements = [
          ...new Set(prefixes.flatMap(p => [...schema.matchAll(new RegExp(`ref="${p}:([\\w-]+)"`, 'g'))].map(m => m[1])))
        ];
        const stub = `${name}-stub-${LAX_NAMESPACES.indexOf(namespace)}.xsd`;
        writeFileSync(path.join(CACHE_DIR, stub), laxSchema(namespace, elements.length ? elements : ['unused']));
        schema = schema.replace(location, stub);
      }
    }
    writeFileSync(schemaPath, schema);
    return schemaPath;
  } catch (error) {
    console.warn(`${name} XSD could not be downloaded, skipping XSD validation:`, error);
    return null;
  }
};

/** Returns '' when the XML is valid, otherwise the xmllint errors. */
export const validateXml = (xml: string, schemaPath: string): string => {
  const file = path.join(CACHE_DIR, `validate-${process.pid}-${Math.random().toString(36).slice(2)}.xml`);
  writeFileSync(file, xml);
  try {
    execFileSync('xmllint', ['--noout', '--nonet', '--schema', schemaPath, file], { stdio: 'pipe' });
    return '';
  } catch (error) {
    return String((error as { stderr?: Buffer }).stderr ?? error)
      .replaceAll(file, '<output>')
      .replace(/<output> fails to validate\s*$/, '')
      .trim();
  }
};

export const QTI21_XSD_URL = 'https://www.imsglobal.org/xsd/qti/qtiv2p1/imsqti_v2p1p2.xsd';
export const QTI3_XSD_URL = 'https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqti_asiv3p0p1_v1p0.xsd';
