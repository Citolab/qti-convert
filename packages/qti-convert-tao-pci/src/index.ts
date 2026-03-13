import * as cheerio from 'cheerio';
import { qtiTransform } from '@citolab/qti-convert/qti-transformer';
import { BUNDLED_TAO_ASSETS } from './bundled-assets';

export type ProcessedType = 'test' | 'item' | 'manifest' | 'other';
export type ProcessedMap = Map<string, { content: string | Buffer; type: ProcessedType }>;

const localTaoRequirePaths: Record<string, string> = {
  'taoQtiItem/portableLib/OAT/util/event': 'modules/portableLib/OAT/util/event',
  'taoQtiItem/portableLib/OAT/util/html': 'modules/portableLib/OAT/util/html',
  'taoQtiItem/portableLib/OAT/util/EventMgr': 'modules/portableLib/OAT/util/EventMgr',
  'taoQtiItem/portableLib/OAT/util/math': 'modules/portableLib/OAT/util/math',
  'taoQtiItem/portableLib/OAT/util/xml': 'modules/portableLib/OAT/util/xml',
  'taoQtiItem/portableLib/OAT/util/tooltip': 'modules/portableLib/OAT/util/tooltip',
  'taoQtiItem/portableLib/OAT/util/tpl': 'modules/portableLib/OAT/util/tpl',
  'taoQtiItem/portableLib/OAT/util/asset': 'modules/portableLib/OAT/util/asset',
  'taoQtiItem/portableLib/OAT/waitForMedia': 'modules/portableLib/OAT/waitForMedia',
  'taoQtiItem/portableLib/OAT/mediaPlayer': 'modules/portableLib/OAT/mediaPlayer',
  'taoQtiItem/portableLib/OAT/scale.raphael': 'modules/portableLib/OAT/scale.raphael',
  'taoQtiItem/portableLib/OAT/interact-rotate': 'modules/portableLib/OAT/interact-rotate',
  'taoQtiItem/portableLib/OAT/promise': 'modules/portableLib/OAT/promise',
  'taoQtiItem/portableLib/OAT/sts/common': 'modules/portableLib/OAT/sts/common',
  'taoQtiItem/portableLib/OAT/sts/transform-helper': 'modules/portableLib/OAT/sts/transform-helper',
  'taoQtiItem/portableLib/OAT/sts/stsEventManager': 'modules/portableLib/OAT/sts/stsEventManager',
  'taoQtiItem/portableLib/async': 'modules/portableLib/async',
  'taoQtiItem/portableLib/interact': 'modules/portableLib/interact',
  'taoQtiItem/portableLib/es6-promise': 'modules/portableLib/es6-promise',
  'taoQtiItem/portableLib/jquery_2_1_1': 'modules/portableLib/jquery_2_1_1',
  'taoQtiItem/portableLib/jquery.qtip': 'modules/portableLib/jquery.qtip',
  'taoQtiItem/portableLib/lodash': 'modules/portableLib/lodash',
  'taoQtiItem/portableLib/handlebars': 'modules/portableLib/handlebars',
  'taoQtiItem/portableLib/raphael': 'modules/portableLib/raphael',
  'taoQtiItem/pci-scripts/portableLib/jquery.qtip': 'modules/portableLib/jquery.qtip',
  'taoQtiItem/pci-scripts/portableLib/lodash': 'modules/portableLib/lodash',
  'taoQtiItem/pci-scripts/portableLib/raphael': 'modules/portableLib/raphael',
  'IMSGlobal/jquery_2_1_1': 'modules/IMSGlobal/jquery_2_1_1',
  'OAT/util/event': 'modules/legacyPortableSharedLib/OAT/util/event',
  'OAT/util/html': 'modules/legacyPortableSharedLib/OAT/util/html',
  'OAT/util/EventMgr': 'modules/legacyPortableSharedLib/OAT/util/EventMgr',
  'OAT/util/math': 'modules/legacyPortableSharedLib/OAT/util/math',
  'OAT/util/xml': 'modules/legacyPortableSharedLib/OAT/util/xml',
  'OAT/util/tooltip': 'modules/portableLib/OAT/util/tooltip',
  'OAT/lodash': 'modules/legacyPortableSharedLib/lodash',
  mathJax: 'modules/mathjax/mathJax',
  css: 'modules/css/css'
};

const taoToQtiClassMap: Record<string, string> = {
  'grid-row': 'qti-layout-row',
  row: 'qti-layout-row',
  'txt-ctr': 'qti-align-center',
  'txt-rgt': 'qti-align-right',
  'txt-lft': 'qti-align-left',
  'text-center': 'qti-align-center',
  'text-right': 'qti-align-right',
  'text-left': 'qti-align-left',
  'text-start': 'qti-align-left',
  'text-end': 'qti-align-right',
  'pull-left': 'qti-float-left',
  'pull-right': 'qti-float-right',
  'float-left': 'qti-float-left',
  'float-right': 'qti-float-right',
  'float-none': 'qti-float-none',
  clearfix: 'qti-float-clearfix',
  'd-block': 'qti-display-block',
  'd-inline': 'qti-display-inline',
  'd-inline-block': 'qti-display-inline-block',
  'd-flex': 'qti-display-flex',
  'd-inline-flex': 'qti-display-inline-flex',
  'd-grid': 'qti-display-grid',
  'd-inline-grid': 'qti-display-inline-grid',
  'd-none': 'qti-hidden',
  'w-100': 'qti-width-full',
  'h-100': 'qti-height-full'
};

const LEGACY_BUTTON_COMPAT_CSS = `/* Legacy TAO PCI compatibility: variant button classes without .btn */
button[class*="btn-"].small:not(.btn),
input[type="button"][class*="btn-"].small:not(.btn),
input[type="submit"][class*="btn-"].small:not(.btn) {
  display: inline-block;
  padding: 5px 10px;
  margin-bottom: 0;
  font-size: 12px;
  font-weight: normal;
  line-height: 1.5;
  text-align: center;
  white-space: nowrap;
  vertical-align: middle;
  cursor: pointer;
  border: 1px solid transparent;
  border-radius: 3px;
  user-select: none;
}

button.btn-info.small:not(.btn),
input[type="button"].btn-info.small:not(.btn),
input[type="submit"].btn-info.small:not(.btn) {
  color: #ffffff;
  background-color: #5bc0de;
  border-color: #46b8da;
}

button.btn-info.small:not(.btn):hover,
button.btn-info.small:not(.btn):focus,
button.btn-info.small:not(.btn):active,
input[type="button"].btn-info.small:not(.btn):hover,
input[type="button"].btn-info.small:not(.btn):focus,
input[type="button"].btn-info.small:not(.btn):active,
input[type="submit"].btn-info.small:not(.btn):hover,
input[type="submit"].btn-info.small:not(.btn):focus,
input[type="submit"].btn-info.small:not(.btn):active {
  color: #ffffff;
  background-color: #39b3d7;
  border-color: #269abc;
}
`;

function getItemDir(itemPath: string): string {
  return itemPath.includes('/') ? itemPath.slice(0, itemPath.lastIndexOf('/') + 1) : '';
}

function setNestedValue(root: Record<string, unknown>, keyPath: string[], value: string): void {
  let cursor: Record<string, unknown> = root;
  for (let i = 0; i < keyPath.length; i += 1) {
    const key = keyPath[i];
    const isLast = i === keyPath.length - 1;
    if (isLast) {
      cursor[key] = value;
      continue;
    }
    if (!cursor[key] || typeof cursor[key] !== 'object') {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
}

function dashedToCamelCase(input: string): string {
  if (!input.includes('-')) return input;
  return input.replace(/-([a-zA-Z0-9])/g, (_all, chr: string) => chr.toUpperCase());
}

function normalizeLegacyConfigKeySegment(segment: string): string {
  if (/^\d+$/.test(segment)) return segment;
  return dashedToCamelCase(segment);
}

function toStructuredValue(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const object = input as Record<string, unknown>;
  const keys = Object.keys(object);
  const isNumericMap = keys.length > 0 && keys.every(key => /^\d+$/.test(key));

  if (isNumericMap) {
    return keys
      .sort((a, b) => Number(a) - Number(b))
      .map(key => toStructuredValue(object[key]));
  }

  return keys.reduce<Record<string, unknown>>((acc, key) => {
    acc[key] = toStructuredValue(object[key]);
    return acc;
  }, {});
}

function decodeHtmlEntities(value: string): string {
  if (!value.includes('&')) return value;
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function toDashedNotation(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
}

type PropertyRehydrationMap = Record<string, string>;

function collectRootPropertyRehydrationMaps(xml: string): PropertyRehydrationMap[] {
  const $ = cheerio.load(xml, { xmlMode: true, xml: true });
  const maps: PropertyRehydrationMap[] = [];
  const pciNodes = $('qti-custom-interaction > qti-portable-custom-interaction, customInteraction > portableCustomInteraction');

  const collectMappings = (
    element: any,
    rootPath: string,
    relativePath: string[],
    output: PropertyRehydrationMap
  ) => {
    $(element)
      .children()
      .each((_, child) => {
        const key = $(child).attr('key');
        if (!key) return;

        const nextRelative = [...relativePath, toDashedNotation(key)];
        if ($(child).children().length > 0) {
          collectMappings(child, rootPath, nextRelative, output);
          return;
        }

        const flat = nextRelative.join('__');
        const scoped = `${rootPath}__${flat}`;
        if (flat !== scoped) {
          output[flat] = scoped;
        }
      });
  };

  pciNodes.each((_, pci) => {
    const mapping: PropertyRehydrationMap = {};

    $(pci)
      .children('properties[key]')
      .each((_, root) => {
        const rootKey = $(root).attr('key');
        if (!rootKey) return;
        collectMappings(root, toDashedNotation(rootKey), [], mapping);
      });

    maps.push(mapping);
  });

  return maps;
}

function rehydrateRootScopedDataAttributes(xml: string, maps: PropertyRehydrationMap[]): string {
  if (maps.length === 0) return xml;

  const $ = cheerio.load(xml, { xmlMode: true, xml: true });
  const pciNodes = $('qti-portable-custom-interaction, portableCustomInteraction');
  let changed = false;

  pciNodes.each((index, pci) => {
    const mapping = maps[index];
    if (!mapping) return;

    Object.entries(mapping).forEach(([flat, scoped]) => {
      const flatAttribute = `data-${flat}`;
      const scopedAttribute = `data-${scoped}`;
      const flatValue = $(pci).attr(flatAttribute);
      if (flatValue === undefined) return;
      if ($(pci).attr(scopedAttribute) !== undefined) return;

      $(pci).attr(scopedAttribute, flatValue);
      $(pci).removeAttr(flatAttribute);
      changed = true;
    });
  });

  return changed ? $.xml() : xml;
}

function buildLegacyConfigFromDataAttributes(attributes: Record<string, string>): string {
  const root: Record<string, unknown> = {};

  Object.entries(attributes).forEach(([name, value]) => {
    if (!name.startsWith('data-')) return;
    if (name.startsWith('data-content-')) return;
    if (name === 'data-legacy-pci-config') return;
    if (name === 'data-require-paths') return;
    if (name === 'data-legacy-pci-proxy') return;

    const key = name.slice('data-'.length);
    const path = key
      .split('__')
      .filter(Boolean)
      .map(normalizeLegacyConfigKeySegment);
    if (path.length === 0) return;
    setNestedValue(root, path, decodeHtmlEntities(value));
  });

  return JSON.stringify(toStructuredValue(root));
}

function mapTaoClassToQtiClass(token: string): string | null {
  const directMatch = taoToQtiClassMap[token];
  if (directMatch) return directMatch;

  const colMatch = token.match(/^col(?:-(?:xs|sm|md|lg|xl|xxl))?-(1[0-2]|[1-9])$/);
  if (colMatch) return `qti-layout-col${colMatch[1]}`;

  const offsetMatch = token.match(/^offset-(1[0-2]|[1-9])$/);
  if (offsetMatch) return `qti-layout-offset${offsetMatch[1]}`;

  const colOffsetMatch = token.match(/^col-(?:xs|sm|md|lg|xl|xxl)-offset-(1[0-2]|[1-9])$/);
  if (colOffsetMatch) return `qti-layout-offset${colOffsetMatch[1]}`;

  return null;
}

function normalizeLegacyBootstrapButtonClasses(tokens: string[]): string[] {
  const hasBootstrapVariant = tokens.some(token => /^btn-[a-z0-9-]+$/i.test(token) && token !== 'btn-group' && token !== 'btn-toolbar');
  if (!hasBootstrapVariant) return tokens;

  const nextTokens = tokens.filter(token => token !== 'small');
  if (!nextTokens.includes('btn')) {
    nextTokens.unshift('btn');
  }
  if (!nextTokens.includes('btn-sm')) {
    nextTokens.push('btn-sm');
  }
  return nextTokens;
}

function convertClassList(classValue: string): string {
  const tokens = classValue.split(/\s+/).filter(Boolean);
  const normalizedTokens = normalizeLegacyBootstrapButtonClasses(tokens);
  const nextTokens: string[] = [];
  for (const token of normalizedTokens) {
    if (!nextTokens.includes(token)) nextTokens.push(token);
    const qtiClass = mapTaoClassToQtiClass(token);
    if (qtiClass && !nextTokens.includes(qtiClass)) {
      nextTokens.push(qtiClass);
    }
  }
  return nextTokens.join(' ');
}

function convertClassAssignmentsInHtml(html: string): string {
  return html
    .replace(/class\s*=\s*"([^"]*)"/gi, (_all, classValue: string) => `class="${convertClassList(classValue)}"`)
    .replace(/class\s*=\s*'([^']*)'/gi, (_all, classValue: string) => `class='${convertClassList(classValue)}'`);
}

function applyTaoStyleConversion($: cheerio.CheerioAPI): void {
  $('[class]').each((_, element) => {
    const currentClass = $(element).attr('class');
    if (!currentClass) return;
    $(element).attr('class', convertClassList(currentClass));
  });

  $('qti-portable-custom-interaction').each((_, interaction) => {
    const attributes = interaction.attribs || {};
    for (const [name, value] of Object.entries(attributes)) {
      if (!name.startsWith('data-')) continue;
      if (!value || !/\bclass\s*=/.test(value)) continue;
      $(interaction).attr(name, convertClassAssignmentsInHtml(value));
    }
  });
}

function convertHandlebarsPathsInExpression(expression: string): string {
  const quotedPattern = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;
  const pathPattern = /(^|[^A-Za-z0-9_$@./-])((?:\.\.\/)+|@root\.|this\.)?([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+)/g;
  return expression
    .split(quotedPattern)
    .map((segment, index) => {
      if (index % 2 === 1) return segment;
      return segment.replace(pathPattern, (_match, prefix: string, scope: string, path: string) => {
        const flattened = path.replace(/\./g, '__');
        return `${prefix}${scope || ''}${flattened}`;
      });
    })
    .join('');
}

function convertHandlebarsPathsInTemplate(template: string): string {
  const mustachePattern = /(\{\{\{?)([\s\S]*?)(\}\}\}?)/g;
  return template.replace(mustachePattern, (_match, start: string, body: string, end: string) => {
    return `${start}${convertHandlebarsPathsInExpression(body)}${end}`;
  });
}

function applyHandlebarsTemplateConversion($: cheerio.CheerioAPI): void {
  $('script[type="text/x-handlebars-template"], script[type="text/x-handlebars"]').each((_, element) => {
    const current = $(element).text();
    if (!current) return;
    const next = convertHandlebarsPathsInTemplate(current);
    if (next !== current) {
      $(element).text(next);
    }
  });
}

function createLegacyProxyModuleSource(originalModuleId: string): string {
  const encodedModuleId = JSON.stringify(originalModuleId);
  return `define(['require'], function(require) {
  'use strict';

  var sourceModuleId = ${encodedModuleId};

  function createInstanceBridge(legacyInstance) {
    return {
      getResponse: function() {
        return typeof legacyInstance.getResponse === 'function' ? legacyInstance.getResponse() : null;
      },
      setResponse: function(response) {
        if (typeof legacyInstance.setResponse === 'function') {
          legacyInstance.setResponse(response);
        }
      },
      getState: function() {
        return typeof legacyInstance.getSerializedState === 'function' ? legacyInstance.getSerializedState() : null;
      },
      setState: function(state) {
        if (typeof legacyInstance.setSerializedState === 'function') {
          legacyInstance.setSerializedState(state);
        }
      },
      checkValidity: function() {
        return typeof legacyInstance.checkValidity === 'function' ? !!legacyInstance.checkValidity() : true;
      },
      getCustomValidity: function() {
        return typeof legacyInstance.getCustomValidity === 'function' ? legacyInstance.getCustomValidity() : '';
      }
    };
  }

  function normalizeState(state) {
    if (typeof state === 'string' && state.indexOf('__qti_json__::') === 0) {
      try {
        return JSON.parse(state.substring('__qti_json__::'.length));
      } catch (e) {
        return state;
      }
    }
    return state;
  }

  function wrapLegacyRegistration(qtiCustomInteractionContext, legacyRegistration) {
    function decodeHtmlEntities(value) {
      if (typeof value !== 'string' || value.indexOf('&') === -1) {
        return value;
      }

      if (typeof document !== 'undefined' && document.createElement) {
        var txt = document.createElement('textarea');
        txt.innerHTML = value;
        return txt.value;
      }

      return value
        .replace(/&quot;/g, '"')
        .replace(/&#34;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
    }

    return {
      getInstance: function(dom, configuration, state) {
        if (!legacyRegistration || typeof legacyRegistration.initialize !== 'function') {
          throw new Error('Legacy TAO PCI registration has no initialize() for module ' + sourceModuleId);
        }

        var legacyInstance = Object.create(legacyRegistration);
        var properties = configuration && configuration.properties ? configuration.properties : {};

        var rawConfig = properties.legacyPciConfig || properties['legacy-pci-config'] || '';
        var legacyConfig = null;
        if (typeof rawConfig === 'string' && rawConfig.length) {
          var normalizedConfig = decodeHtmlEntities(rawConfig);
          try {
            var parsedConfig = JSON.parse(normalizedConfig);
            if (parsedConfig && typeof parsedConfig === 'object') {
              legacyConfig = parsedConfig;
            }
          } catch (e) {
            legacyConfig = null;
          }
        } else if (rawConfig && typeof rawConfig === 'object') {
          legacyConfig = rawConfig;
        }

        legacyInstance._taoCustomInteraction = {
          serial: configuration && configuration.responseIdentifier ? configuration.responseIdentifier : '',
          properties: legacyConfig || properties,
          renderer: {
            resolveUrl: function(source) {
              return source;
            }
          }
        };

        var root = dom && dom.firstElementChild ? dom.firstElementChild : dom;
        legacyInstance.initialize(
          configuration && configuration.responseIdentifier ? configuration.responseIdentifier : '',
          root,
          legacyConfig
        );

        if (configuration && configuration.boundTo && configuration.responseIdentifier && typeof legacyInstance.setResponse === 'function') {
          var boundValue = configuration.boundTo[configuration.responseIdentifier];
          if (boundValue !== undefined) {
            legacyInstance.setResponse(boundValue);
          }
        }

        if (state && typeof legacyInstance.setSerializedState === 'function') {
          legacyInstance.setSerializedState(state);
        }

        if (configuration && typeof configuration.onready === 'function') {
          configuration.onready(createInstanceBridge(legacyInstance));
        }
      }
    };
  }

  require(['qtiCustomInteractionContext'], function(qtiCustomInteractionContext) {
    var originalRegister = qtiCustomInteractionContext.register;

    qtiCustomInteractionContext.register = function(registration) {
      if (registration && typeof registration.getInstance === 'function') {
        return originalRegister.call(qtiCustomInteractionContext, registration);
      }
      return originalRegister.call(qtiCustomInteractionContext, wrapLegacyRegistration(qtiCustomInteractionContext, registration));
    };

    require([sourceModuleId], function () {}, function (err) {
      throw err;
    });
  }, function(err) {
    throw err;
  });

  return {};
});`;
}

function injectLegacyProxyIntoItemXml(itemPath: string, xml: string): { xml: string; proxies: Array<{ path: string; content: string }> } {
  const $ = cheerio.load(xml, { xmlMode: true, xml: true });
  const proxies: Array<{ path: string; content: string }> = [];
  let changed = false;

  const itemDir = getItemDir(itemPath);
  const fileName = itemPath.split('/').pop() || itemPath;
  const itemBase = fileName.includes('.') ? fileName.slice(0, fileName.lastIndexOf('.')) : fileName;

  $('qti-portable-custom-interaction[data-legacy-pci-proxy="1"]').each((idx, pciEl) => {
    const pci = $(pciEl);
    const originalModuleId = pci.attr('module');
    if (!originalModuleId) return;

    const modulesRoot = pci.find('qti-interaction-modules').first();
    if (modulesRoot.length === 0) return;
    if (modulesRoot.find(`qti-interaction-module[id="${originalModuleId}"]`).length === 0) return;

    const proxyModuleId = `${originalModuleId}__legacy_proxy_${idx}`;
    if (modulesRoot.find(`qti-interaction-module[id="${proxyModuleId}"]`).length > 0) return;

    const proxyFileName = `${itemBase}.legacy-pci-proxy.${idx}.js`;
    const proxyPath = `${itemDir}${proxyFileName}`;

    modulesRoot.append(`<qti-interaction-module id="${proxyModuleId}" primary-path="${proxyFileName}"></qti-interaction-module>`);
    pci.attr('module', proxyModuleId);
    pci.attr('data-legacy-pci-source-module', originalModuleId);

    proxies.push({ path: proxyPath, content: createLegacyProxyModuleSource(originalModuleId) });
    changed = true;
  });

  return { xml: changed ? $.xml() : xml, proxies };
}

function ensureTaoModuleMappings($: cheerio.CheerioAPI, pci: any): void {
  let modulesRoot = $(pci).find('qti-interaction-modules').first();
  if (modulesRoot.length === 0) {
    $(pci).prepend('<qti-interaction-modules></qti-interaction-modules>');
    modulesRoot = $(pci).find('qti-interaction-modules').first();
  }

  Object.entries(localTaoRequirePaths).forEach(([id, primaryPath]) => {
    if (modulesRoot.find(`qti-interaction-module[id="${id}"]`).length > 0) return;
    modulesRoot.append(`<qti-interaction-module id="${id}" primary-path="${primaryPath}"></qti-interaction-module>`);
  });

  const hasBootstrap = $(pci)
    .find('qti-stylesheet')
    .toArray()
    .some(node => (($(node).attr('href') || '') as string).toLowerCase().includes('bootstrap'));

  if (!hasBootstrap) {
    $(pci).append('<qti-stylesheet href="modules/bootstrap/bootstrap.min.css" type="text/css"></qti-stylesheet>');
  }

  const hasLegacyButtonCompat = $(pci)
    .find('qti-stylesheet')
    .toArray()
    .some(node => (($(node).attr('href') || '') as string).toLowerCase().includes('legacy-button-compat.css'));

  if (!hasLegacyButtonCompat) {
    $(pci).append('<qti-stylesheet href="modules/legacy/legacy-button-compat.css" type="text/css"></qti-stylesheet>');
  }
}

function applyTaoPciEnhancements(itemPath: string, xml: string): { xml: string; isTao: boolean; hasPci: boolean } {
  const $ = cheerio.load(xml, { xmlMode: true, xml: true });
  applyTaoStyleConversion($);

  const assessmentItem = $('qti-assessment-item, assessmentItem').first();
  const isTao = ((assessmentItem.attr('tool-name') || assessmentItem.attr('toolName') || '') as string).toUpperCase() === 'TAO';
  if (!isTao) {
    return { xml: $.xml(), isTao: false, hasPci: false };
  }

  applyHandlebarsTemplateConversion($);

  const hasPci = $('qti-portable-custom-interaction').length > 0;
  if (!hasPci) {
    return { xml: $.xml(), isTao: true, hasPci: false };
  }

  $('qti-portable-custom-interaction').each((_, pci) => {
    const attributes = (pci.attribs || {}) as Record<string, string>;
    const legacyConfig = buildLegacyConfigFromDataAttributes(attributes);

    $(pci).attr('data-legacy-pci-proxy', '1');
    $(pci).attr('data-require-paths', JSON.stringify(localTaoRequirePaths));
    $(pci).attr('data-use-default-shims', 'true');
    if (legacyConfig && legacyConfig !== '{}') {
      $(pci).attr('data-legacy-pci-config', legacyConfig);
    }

    ensureTaoModuleMappings($, pci);
  });

  return { xml: $.xml(), isTao: true, hasPci: true };
}

function injectBundledAssetsForItem(processedFiles: ProcessedMap, itemPath: string): void {
  const dir = getItemDir(itemPath);
  BUNDLED_TAO_ASSETS.forEach(asset => {
    const targetPath = `${dir}${asset.path}`;
    if (!processedFiles.has(targetPath)) {
      processedFiles.set(targetPath, {
        content: asset.content,
        type: 'other'
      });
    }
  });

  const legacyButtonCompatPath = `${dir}modules/legacy/legacy-button-compat.css`;
  if (!processedFiles.has(legacyButtonCompatPath)) {
    processedFiles.set(legacyButtonCompatPath, {
      content: LEGACY_BUTTON_COMPAT_CSS,
      type: 'other'
    });
  }
}

function shouldRunUpgradePci(xml: string): boolean {
  const $ = cheerio.load(xml, { xmlMode: true, xml: true });
  const assessmentItem = $('qti-assessment-item, assessmentItem').first();
  if (assessmentItem.length === 0) return false;

  const toolName = String(assessmentItem.attr('tool-name') || assessmentItem.attr('toolName') || '').toUpperCase();
  if (toolName !== 'TAO') return false;

  return $('qti-custom-interaction qti-portable-custom-interaction').length > 0;
}

function runUpgradePci(xml: string): string {
  const transform = qtiTransform(xml);
  if (!transform) return xml;
  return transform.upgradePci().xml();
}

export async function convert(processedFiles: ProcessedMap): Promise<ProcessedMap> {
  for (const [filePath, fileData] of processedFiles.entries()) {
    if (fileData.type !== 'item' || typeof fileData.content !== 'string') {
      continue;
    }

    const propertyRehydrationMaps = collectRootPropertyRehydrationMaps(fileData.content);
    const upgradedXml = shouldRunUpgradePci(fileData.content) ? runUpgradePci(fileData.content) : fileData.content;
    const rehydratedXml = rehydrateRootScopedDataAttributes(upgradedXml, propertyRehydrationMaps);
    const taoEnhanced = applyTaoPciEnhancements(filePath, rehydratedXml);
    const proxied = injectLegacyProxyIntoItemXml(filePath, taoEnhanced.xml);

    processedFiles.set(filePath, {
      ...fileData,
      content: proxied.xml
    });

    proxied.proxies.forEach(proxyFile => {
      processedFiles.set(proxyFile.path, {
        content: proxyFile.content,
        type: 'other'
      });
    });

    if (taoEnhanced.isTao && taoEnhanced.hasPci) {
      injectBundledAssetsForItem(processedFiles, filePath);
    }
  }

  return processedFiles;
}
