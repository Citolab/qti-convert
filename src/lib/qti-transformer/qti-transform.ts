import * as cheerio from 'cheerio';
import xmlFormat from 'xml-formatter';
import {
  stripMaterialInfo,
  customTypes,
  objectToImg,
  objectToVideo,
  suffixa,
  toMathMLWebcomponents,
  qbCleanup,
  minChoicesToOne,
  externalScored,
  changeAssetLocation,
  changeAssetLocationAsync,
  stripStylesheets
} from './transformers';

export const qtiReferenceAttributes = ['src', 'href', 'data', 'primary-path', 'fallback-path', 'template-location'];

// Define the types for the API methods
interface QtiTransformAPI {
  fnCh(fn: (xmlString: cheerio.CheerioAPI) => void): QtiTransformAPI;
  fnChAsync(fn: (xmlString: cheerio.CheerioAPI) => Promise<void>): Promise<QtiTransformAPI>;
  mathml(): QtiTransformAPI;
  objectToVideo(): QtiTransformAPI;
  objectToImg(): QtiTransformAPI;
  changeAssetLocation(
    getNewUrl: (oldUrl: string) => string,
    srcAttribute?: string[],
    skipBase64?: boolean
  ): QtiTransformAPI;
  changeAssetLocationAsync(
    getNewUrlAsync: (oldUrl: string) => Promise<string>,
    srcAttribute?: string[],
    skipBase64?: boolean
  ): Promise<QtiTransformAPI>;
  stripStylesheets(): QtiTransformAPI;
  customTypes(): QtiTransformAPI;
  stripMaterialInfo(): QtiTransformAPI;
  qbCleanup(): QtiTransformAPI;
  minChoicesToOne(): QtiTransformAPI;
  suffix(elements: string[], suffix: string): QtiTransformAPI;
  externalScored(): QtiTransformAPI;
  xml(): string;
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
    stripStylesheets() {
      stripStylesheets($);
      return api;
    },
    customTypes() {
      customTypes($);
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
    }
  };
  return api;
};
