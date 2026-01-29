import * as cheerio from 'cheerio';
import xmlFormat from 'xml-formatter';
import {
  stripMaterialInfo,
  customTypes,
  objectToImg,
  objectToVideo,
  objectToAudio,
  ssmlSubToSpan,
  upgradePci,
  suffixa,
  toMathMLWebcomponents,
  qbCleanup,
  depConvert,
  depConvertExtended,
  hideInputsForChoiceInteractionWithImages,
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
  fnCh(fn: (xml: cheerio.CheerioAPI) => void): QtiTransformAPI;
  fnChAsync(fn: (xml: cheerio.CheerioAPI) => Promise<void>): Promise<QtiTransformAPI>;
  mathml(): QtiTransformAPI;
  objectToVideo(): QtiTransformAPI;
  objectToAudio(): QtiTransformAPI;
  objectToImg(): QtiTransformAPI;
  ssmlSubToSpan(): QtiTransformAPI;
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
  upgradePci(): QtiTransformAPI;
  stripStylesheets(options?: { removePattern?: string; keepPattern?: string }): QtiTransformAPI;
  customTypes(): QtiTransformAPI;
  stripMaterialInfo(): QtiTransformAPI;
  qbCleanup(): QtiTransformAPI;
  depConvert(): QtiTransformAPI;
  depConvertExtended(): QtiTransformAPI;
  hideInputsForChoiceInteractionWithImages(): QtiTransformAPI;
  minChoicesToOne(): QtiTransformAPI;
  suffix(elements: string[], suffix: string): QtiTransformAPI;
  externalScored(): QtiTransformAPI;
  xml(): string;
  browser: {
    htmldoc: () => DocumentFragment;
    xmldoc: () => XMLDocument;
  };
}
function stripNamespaces(node: Node, doc: Document): Node {
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element;
    const newEl = doc.createElement(el.localName);
    for (let i = 0; i < el.attributes.length; i++) {
      const attr = el.attributes[i];
      newEl.setAttribute(attr.localName, attr.value);
    }
    for (let i = 0; i < el.childNodes.length; i++) {
      newEl.appendChild(stripNamespaces(el.childNodes[i], doc));
    }
    return newEl;
  }
  return node.cloneNode(false);
}

function toHTML(xmlFragment: Document): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < xmlFragment.childNodes.length; i++) {
    fragment.appendChild(stripNamespaces(xmlFragment.childNodes[i], document));
  }
  return fragment;
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
    ssmlSubToSpan() {
      ssmlSubToSpan($);
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
    upgradePci() {
      upgradePci($);
      return api;
    },
    stripStylesheets(options?: { removePattern?: string; keepPattern?: string }) {
      stripStylesheets($, options);
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
    depConvertExtended() {
      depConvertExtended($);
      return api;
    },
    hideInputsForChoiceInteractionWithImages() {
      hideInputsForChoiceInteractionWithImages($);
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
