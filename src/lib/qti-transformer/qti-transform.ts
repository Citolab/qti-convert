import * as cheerio from 'cheerio';
import xmlFormat from 'xml-formatter';
import {
  stripMaterialInfo,
  customTypes,
  objectToImg,
  objectToVideo,
  objectToAudio,
  upgradePci,
  suffixa,
  toMathMLWebcomponents,
  qbCleanup,
  depConvert,
  minChoicesToOne,
  externalScored,
  changeAssetLocation,
  changeAssetLocationAsync,
  configurePciAsync,
  stripStylesheets
} from './transformers';
import { customInteraction } from './transformers/custom-interaction';
import { ModuleResolutionConfig } from './transformers/configure-pci';

export { type ModuleResolutionConfig } from './transformers/configure-pci';
export const qtiReferenceAttributes = ['src', 'href', 'data', 'primary-path', 'fallback-path', 'template-location'];

// Define the types for the API methods
interface QtiTransformAPI {
  fnCh(fn: (xmlString: cheerio.CheerioAPI) => void): QtiTransformAPI;
  fnChAsync(fn: (xmlString: cheerio.CheerioAPI) => Promise<void>): Promise<QtiTransformAPI>;
  mathml(): QtiTransformAPI;
  objectToVideo(): QtiTransformAPI;
  objectToAudio(): QtiTransformAPI;
  objectToImg(): QtiTransformAPI;
  changeAssetLocation(
    getNewUrl: (oldUrl: string) => string,
    srcAttribute?: string[],
    skipBase64?: boolean
  ): QtiTransformAPI;
  customInteraction(baseRef: string, baseItem: string): QtiTransformAPI;
  changeAssetLocationAsync(
    getNewUrlAsync: (oldUrl: string) => Promise<string>,
    srcAttribute?: string[],
    skipBase64?: boolean
  ): Promise<QtiTransformAPI>;
  configurePciAsync(
    baseUrl: string,
    getModuleResolutionConfig: (url: string) => Promise<ModuleResolutionConfig>
  ): Promise<QtiTransformAPI>;
  upgradePci(baseUrl: string): QtiTransformAPI;
  stripStylesheets(): QtiTransformAPI;
  customTypes(): QtiTransformAPI;
  stripMaterialInfo(): QtiTransformAPI;
  qbCleanup(): QtiTransformAPI;
  depConvert(): QtiTransformAPI;
  minChoicesToOne(): QtiTransformAPI;
  suffix(elements: string[], suffix: string): QtiTransformAPI;
  externalScored(): QtiTransformAPI;
  xml(): string;
  browser: {
    htmldoc: () => DocumentFragment;
    xmldoc: () => XMLDocument;
  };
}
const xml = String.raw;
const xmlToHTML = xml`<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="html" version="5.0" encoding="UTF-8" indent="yes" />
  <xsl:template match="@*|node()">
    <xsl:copy>
      <xsl:apply-templates select="@*|node()"/>
    </xsl:copy>
  </xsl:template>

  <!-- remove existing namespaces -->
  <xsl:template match="*">
    <!-- remove element prefix -->
    <xsl:element name="{local-name()}">
      <!-- process attributes -->
      <xsl:for-each select="@*">
        <!-- remove attribute prefix -->
        <xsl:attribute name="{local-name()}">
          <xsl:value-of select="."/>
        </xsl:attribute>
      </xsl:for-each>
    <xsl:apply-templates/>
  </xsl:element>
</xsl:template>
</xsl:stylesheet>`;

function toHTML(xmlFragment: Document): DocumentFragment {
  const processor = new XSLTProcessor();
  const xsltDocument = new DOMParser().parseFromString(xmlToHTML, 'text/xml');
  processor.importStylesheet(xsltDocument);
  const itemHTMLFragment = processor.transformToFragment(xmlFragment, document);
  return itemHTMLFragment;
}

function parseXML(xmlDocument: string) {
  const parser = new DOMParser();
  const xmlFragment = parser.parseFromString(xmlDocument, 'text/xml');
  return xmlFragment;
}

export const qtiTransform = (xmlValue: string): QtiTransformAPI => {
  // the XML which will be transformed
  const $ = cheerio.load(xmlValue, {
    xmlMode: true,
    xml: true,
    _useHtmlParser2: true,
    decodeEntities: true
  } as unknown);

  const api: QtiTransformAPI = {
    fnCh(fn: (xmlString: cheerio.CheerioAPI) => void) {
      fn($);
      return api;
    },
    async fnChAsync(fn: (xmlString: cheerio.CheerioAPI) => Promise<void>): Promise<QtiTransformAPI> {
      await fn($);
      return api;
    },
    mathml() {
      toMathMLWebcomponents($);
      return api;
    },
    objectToVideo() {
      objectToVideo($);
      return api;
    },
    objectToAudio() {
      objectToAudio($);
      return api;
    },
    objectToImg() {
      objectToImg($);
      return api;
    },
    changeAssetLocation(getNewUrl: (oldUrl: string) => string, srcAttribute?: string[], skipBase64 = true) {
      changeAssetLocation($, getNewUrl, srcAttribute, skipBase64);
      return api;
    },
    async changeAssetLocationAsync(
      getNewUrlAsync: (oldUrl: string) => Promise<string>,
      srcAttribute?: string[],
      skipBase64 = true
    ) {
      await changeAssetLocationAsync($, getNewUrlAsync, srcAttribute, skipBase64);
      return api;
    },
    async configurePciAsync(
      baseUrl: string,
      getModuleResolutionConfig: (url: string) => Promise<ModuleResolutionConfig>
    ) {
      await configurePciAsync($, baseUrl, getModuleResolutionConfig);
      return api;
    },
    upgradePci(baseUrl: string) {
      upgradePci($, baseUrl);
      return api;
    },
    stripStylesheets() {
      stripStylesheets($);
      return api;
    },
    customTypes() {
      customTypes($);
      return api;
    },
    customInteraction(baseRef: string, baseItem: string) {
      customInteraction($, baseRef, baseItem);
      return api;
    },
    stripMaterialInfo() {
      stripMaterialInfo($);
      return api;
    },
    qbCleanup() {
      qbCleanup($);
      return api;
    },
    depConvert() {
      depConvert($);
      return api;
    },
    minChoicesToOne() {
      minChoicesToOne($);
      return api;
    },
    suffix(elements: string[], suffix: string) {
      suffixa($, elements, suffix);
      return api;
    },
    externalScored() {
      externalScored($);
      return api;
    },
    xml() {
      let xmlString = $.xml();
      // Remove the BOM character if it exists: https://github.com/cheeriojs/cheerio/issues/1117
      if (xmlString.startsWith('&#xfeff;')) {
        xmlString = xmlString.replace('&#xfeff;', '');
      }
      const formattedXML = xmlFormat(xmlString, {
        indentation: '  ',
        collapseContent: true,
        lineSeparator: '\n'
      });
      return formattedXML;
    },
    browser: {
      htmldoc() {
        const xmlFragment = parseXML($.html());
        return toHTML(xmlFragment);
      },
      xmldoc(): XMLDocument {
        const xmlFragment = parseXML($.html());
        return xmlFragment;
      }
    }
  };
  return api;
};
