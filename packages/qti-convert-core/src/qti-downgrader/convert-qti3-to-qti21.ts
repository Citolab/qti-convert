import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import {
  GRAPHIC_INTERACTIONS,
  HTML5_TO_HTML4,
  QTI21_NAMESPACE,
  QTI21_SCHEMA_LOCATION,
  QTI3_NAMESPACE,
  QTI3_ONLY_ATTRIBUTES,
  QTI3_ONLY_REMOVE,
  qti3AttributeNameToQti21,
  qti3ElementNameToQti21,
  qti3RpTemplateToQti21
} from './name-map';
import { dirname, isRelativeUrl, joinPath, mimeTypeFromPath } from './path-utils';

export type Qti21WarningCode =
  | 'already-qti2'
  | 'not-qti'
  | 'stimulus-inlined'
  | 'stimulus-unresolved'
  | 'stimulus-standalone'
  | 'removed-element'
  | 'removed-attribute'
  | 'data-attributes-removed'
  | 'ssml-removed'
  | 'media-to-object'
  | 'img-to-object'
  | 'html5-element'
  | 'pci'
  | 'shared-vocabulary-classes';

export interface Qti21Warning {
  code: Qti21WarningCode;
  message: string;
  file?: string;
}

export interface Qti21ConversionResult {
  xml: string;
  warnings: Qti21Warning[];
}

export interface ConvertQti3toQti21Options {
  /**
   * Returns the QTI 3 stimulus XML for an href of a qti-assessment-stimulus-ref (relative to the item),
   * or undefined when it can't be found. Without a resolver stimulus refs are removed with a warning.
   */
  resolveStimulus?: (href: string) => string | undefined;
  /** Used to tag warnings. */
  filePath?: string;
}

const PCI_NAMESPACE = 'http://www.imsglobal.org/xsd/portableCustomInteraction';
const SKIP_SUBTREES = new Set(['math', 'svg']);
const REBASE_ATTRIBUTES = ['src', 'data', 'href', 'poster'];

const localName = (name: string) => name.split(':').pop() || name;
const isElement = (node: AnyNode): node is Element => node.type === 'tag';

class WarningCollector {
  readonly warnings: Qti21Warning[] = [];
  constructor(private file?: string) {}
  add(code: Qti21WarningCode, message: string) {
    if (!this.warnings.some(w => w.code === code && w.message === message)) {
      this.warnings.push({ code, message, ...(this.file ? { file: this.file } : {}) });
    }
  }
}

const loadXml = (xml: string) =>
  cheerio.load(xml.replace(/<\?xml-model[^?]*\?>/g, '').replace(/^﻿/, ''), { xml: { xmlMode: true, decodeEntities: false } });

const findRoot = ($: cheerio.CheerioAPI): Element | undefined => $.root().children().toArray().find(isElement);

const unwrap = ($: cheerio.CheerioAPI, el: Element) => {
  const $el = $(el);
  $el.before($el.contents());
  $el.remove();
};

/** Removes the prefix of elements that are bound to the QTI 3 namespace (qti:qti-item-body -> qti-item-body). */
const stripQti3Prefixes = ($: cheerio.CheerioAPI) => {
  const prefixes = new Set<string>();
  $('*').each((_, el: Element) => {
    for (const [name, value] of Object.entries(el.attribs || {})) {
      if (name.startsWith('xmlns:') && value.trim() === QTI3_NAMESPACE) {
        prefixes.add(name.slice('xmlns:'.length));
        $(el).removeAttr(name);
      }
    }
  });
  if (prefixes.size === 0) return;
  $('*').each((_, el: Element) => {
    const [prefix, name] = el.name.split(':');
    if (name && prefixes.has(prefix)) {
      el.name = name;
    }
  });
};

const rebaseAssets = ($: cheerio.CheerioAPI, scope: cheerio.Cheerio<AnyNode>, baseDir: string) => {
  if (!baseDir) return;
  scope.find('*').each((_, el: Element) => {
    for (const attr of REBASE_ATTRIBUTES) {
      const value = el.attribs?.[attr];
      if (value && isRelativeUrl(value)) {
        $(el).attr(attr, joinPath(baseDir, value));
      }
    }
  });
};

/** Replaces qti-assessment-stimulus-ref with the stimulus body at the start of the item body. */
const inlineSharedStimuli = (
  $: cheerio.CheerioAPI,
  resolveStimulus: ConvertQti3toQti21Options['resolveStimulus'],
  warnings: WarningCollector
) => {
  $('qti-assessment-stimulus-ref').each((_, ref: Element) => {
    const href = $(ref).attr('href') || '';
    const identifier = $(ref).attr('identifier') || href;
    const stimulusXml = href && resolveStimulus ? resolveStimulus(href) : undefined;
    if (!stimulusXml) {
      warnings.add('stimulus-unresolved', `Shared stimulus "${identifier}" could not be resolved and was removed.`);
      $(ref).remove();
      return;
    }
    const $stimulus = loadXml(stimulusXml);
    stripQti3Prefixes($stimulus);
    const baseDir = dirname(href);
    const $body = $stimulus('qti-stimulus-body').first();
    rebaseAssets($stimulus, $body, baseDir);

    const $itemBody = $('qti-item-body').first();
    $stimulus('qti-stylesheet').each((_, stylesheet: Element) => {
      const $stylesheet = $stimulus(stylesheet);
      const stylesheetHref = $stylesheet.attr('href');
      if (stylesheetHref && isRelativeUrl(stylesheetHref)) {
        $stylesheet.attr('href', joinPath(baseDir, stylesheetHref));
      }
      $itemBody.before($stimulus.xml($stylesheet));
    });
    const lang = $stimulus('qti-assessment-stimulus').attr('xml:lang');
    const langAttr = lang ? ` xml:lang="${lang}"` : '';
    $itemBody.prepend(`<div class="qti-shared-stimulus"${langAttr}>${$body.html() ?? ''}</div>`);
    $(ref).remove();
    warnings.add('stimulus-inlined', `Shared stimulus "${identifier}" was inlined into the item body.`);
  });
};

const guessedObject = (src: string, type: string | undefined, attrs: Record<string, string>, fallback = '') => {
  const attrString = Object.entries(attrs)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([name, value]) => ` ${name}="${value.replace(/"/g, '&quot;')}"`)
    .join('');
  return `<object data="${src}" type="${type || mimeTypeFromPath(src)}"${attrString}>${fallback}</object>`;
};

const convertMediaToObject = ($: cheerio.CheerioAPI, warnings: WarningCollector) => {
  $('audio, video').each((_, el: Element) => {
    const $el = $(el);
    const $source = $el.children('source').first();
    const src = $el.attr('src') || $source.attr('src');
    if (!src) {
      $el.remove();
      warnings.add('media-to-object', `<${el.name}> without a source was removed.`);
      return;
    }
    const { width, height, id, class: className } = el.attribs;
    const fallback = $el
      .contents()
      .filter((_, node) => !isElement(node) || !['source', 'track'].includes(node.name))
      .toArray()
      .map(node => $.xml(node))
      .join('');
    $el.replaceWith(guessedObject(src, $source.attr('type'), { width, height, id, class: className }, fallback));
    warnings.add('media-to-object', `HTML5 <${el.name}> was converted to <object>.`);
  });
};

const convertGraphicImagesToObject = ($: cheerio.CheerioAPI, warnings: WarningCollector) => {
  for (const interaction of GRAPHIC_INTERACTIONS) {
    $(interaction)
      .children('img')
      .each((_, img: Element) => {
        const { src, alt, width, height, id, class: className } = img.attribs;
        $(img).replaceWith(guessedObject(src || '', undefined, { width, height, id, class: className }, alt || ''));
        warnings.add('img-to-object', `<img> in ${interaction} was converted to <object>, as QTI 2.1 requires.`);
      });
  }
};

/** qti-portable-custom-interaction -> customInteraction wrapping the PCI markup in the PCI namespace. */
const convertPci = ($: cheerio.CheerioAPI, warnings: WarningCollector) => {
  $('qti-portable-custom-interaction').each((_, el: Element) => {
    const $el = $(el);
    const pciAttrs = Object.entries(el.attribs)
      .filter(([name]) => name !== 'response-identifier' && !name.startsWith('data-'))
      .map(([name, value]) => ` ${qti3AttributeNameToQti21(name)}="${value}"`)
      .join('');
    const inner = $el.html() ?? '';
    const responseIdentifier = $el.attr('response-identifier') || '';
    $el.replaceWith(
      `<customInteraction responseIdentifier="${responseIdentifier}"><pci:portableCustomInteraction xmlns:pci="${PCI_NAMESPACE}"${pciAttrs}>${inner}</pci:portableCustomInteraction></customInteraction>`
    );
    warnings.add('pci', 'Portable custom interaction was wrapped in a customInteraction; check it in the target player.');
  });
  // Children of the PCI are renamed into the PCI namespace (qti-interaction-markup -> pci:interactionMarkup).
  $('pci\\:portableCustomInteraction *').each((_, el: Element) => {
    const name = qti3ElementNameToQti21(el.name);
    if (name) el.name = `pci:${name}`;
  });
};

const stripSsml = ($: cheerio.CheerioAPI, warnings: WarningCollector) => {
  $('*').each((_, el: Element) => {
    if (el.name.startsWith('ssml:')) {
      unwrap($, el);
      warnings.add('ssml-removed', 'SSML markup is not supported in QTI 2.1 and was removed (text is kept).');
    }
  });
  $('*').each((_, el: Element) => {
    for (const name of Object.keys(el.attribs || {})) {
      if (name.startsWith('xmlns:') && /synthesis/.test(el.attribs[name])) {
        $(el).removeAttr(name);
      }
    }
  });
};

/** Renames elements and attributes to QTI 2.1 and strips what 2.1 doesn't allow. */
const renameTree = ($: cheerio.CheerioAPI, el: Element, warnings: WarningCollector, stats: { dataAttrs: number }) => {
  if (SKIP_SUBTREES.has(localName(el.name)) || el.name.startsWith('pci:')) {
    return;
  }
  const originalName = el.name;
  const qti21Name = qti3ElementNameToQti21(originalName);
  const html4Name = HTML5_TO_HTML4[originalName];

  const newAttribs: Record<string, string> = {};
  for (const [name, value] of Object.entries(el.attribs)) {
    if (name.startsWith('data-')) {
      stats.dataAttrs++;
      continue;
    }
    if (!qti21Name || name.startsWith('aria-') || name.startsWith('xmlns')) {
      newAttribs[name] = value;
      continue;
    }
    if (QTI3_ONLY_ATTRIBUTES[originalName]?.includes(name)) {
      warnings.add('removed-attribute', `Attribute "${name}" on ${originalName} is not supported in QTI 2.1.`);
      continue;
    }
    newAttribs[qti3AttributeNameToQti21(name)] = value;
  }
  el.attribs = newAttribs;

  if (originalName === 'qti-response-processing' && el.attribs.template) {
    el.attribs.template = qti3RpTemplateToQti21(el.attribs.template);
  }
  if (qti21Name) {
    el.name = qti21Name;
  } else if (html4Name) {
    warnings.add('html5-element', `HTML5 <${originalName}> was converted to <${html4Name}>.`);
    el.name = html4Name;
  }

  for (const child of el.children) {
    if (isElement(child)) renameTree($, child, warnings, stats);
  }
};

/**
 * Converts a QTI 3.0 assessment item, test or stimulus to QTI 2.1.
 * Best-effort: constructs without a QTI 2.1 equivalent are converted or removed and reported as warnings.
 */
export const convertQti3toQti21 = (xml: string, options: ConvertQti3toQti21Options = {}): Qti21ConversionResult => {
  const warnings = new WarningCollector(options.filePath);
  const $ = loadXml(xml);
  stripQti3Prefixes($);

  const root = findRoot($);
  if (!root) {
    warnings.add('not-qti', 'No root element found.');
    return { xml, warnings: warnings.warnings };
  }
  if (!root.name.startsWith('qti-')) {
    warnings.add(
      /^(assessmentItem|assessmentTest|assessmentStimulus)$/.test(localName(root.name)) ? 'already-qti2' : 'not-qti',
      `<${root.name}> is not a QTI 3 document; it was left unchanged.`
    );
    return { xml, warnings: warnings.warnings };
  }
  if (root.name === 'qti-assessment-stimulus') {
    warnings.add(
      'stimulus-standalone',
      'assessmentStimulus is a QTI 2.2 construct; QTI 2.1 players will not recognise it.'
    );
  }

  inlineSharedStimuli($, options.resolveStimulus, warnings);

  for (const name of QTI3_ONLY_REMOVE) {
    $(name).each((_, el: Element) => {
      warnings.add('removed-element', `<${name}> is not supported in QTI 2.1 and was removed.`);
      $(el).remove();
    });
  }
  $('qti-content-body').each((_, el: Element) => unwrap($, el));
  convertPci($, warnings);
  convertMediaToObject($, warnings);
  convertGraphicImagesToObject($, warnings);
  $('wbr, track, picture > source').remove();
  $('picture').each((_, el: Element) => unwrap($, el));
  stripSsml($, warnings);

  if ($('[class*="qti-"]').length > 0) {
    warnings.add(
      'shared-vocabulary-classes',
      'QTI 3 shared vocabulary classes (qti-*) were kept; QTI 2.1 players will ignore them.'
    );
  }

  const stats = { dataAttrs: 0 };
  renameTree($, root, warnings, stats);
  if (stats.dataAttrs > 0) {
    warnings.add('data-attributes-removed', `${stats.dataAttrs} data-* attribute(s) were removed.`);
  }

  // Namespaces and schema location
  $('*').each((_, el: Element) => {
    if (el.attribs.xmlns?.trim() === QTI3_NAMESPACE) delete el.attribs.xmlns;
  });
  const { xmlns: _xmlns, 'xmlns:xsi': _xsi, 'xsi:schemaLocation': _schemaLocation, ...rootAttribs } = root.attribs;
  root.attribs = {
    xmlns: QTI21_NAMESPACE,
    'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
    'xsi:schemaLocation': QTI21_SCHEMA_LOCATION,
    ...rootAttribs
  };

  const body = $.xml().replace(/<\?xml[^?]*\?>\s*/, '');
  return { xml: `<?xml version="1.0" encoding="UTF-8"?>\n${body.trimStart()}`, warnings: warnings.warnings };
};
