import * as cheerio from 'cheerio';
import { kebabToDashedNotation } from '../../../utils/utils';

export function upgradePci($: cheerio.CheerioAPI): cheerio.CheerioAPI {
  const customInteraction = $('qti-custom-interaction');
  const portableCustomInteraction = customInteraction.find('qti-portable-custom-interaction');

  if (portableCustomInteraction.length === 0) {
    return $;
  }

  const parseProperties = (element, parentKey = '') => {
    $(element)
      .children()
      .each((_, child) => {
        const key = $(child).attr('key');
        const value = $(child).text().trim();
        if (key) {
          const dashedAttribute = parentKey
            ? `${parentKey}__${kebabToDashedNotation(key)}`
            : kebabToDashedNotation(key);

          if ($(child).children().length > 0) {
            // Recursively parse children with the updated key prefix
            parseProperties(child, dashedAttribute);
          } else {
            // Add attribute for the current property
            portableCustomInteraction.attr(`data-${dashedAttribute}`, value);
          }
        }
      });
  };

  // --------------------------------
  // Remove the <style> tag
  // --------------------------------
  portableCustomInteraction.find('style').remove();

  // --------------------------------------------------------------------------
  // Move properties to data-attributes on qti-portable-custom-interaction
  // Start parsing from the root `properties` element
  // --------------------------------------------------------------------------
  portableCustomInteraction.children('properties').each((_, root) => {
    parseProperties(root);
  });
  portableCustomInteraction.find('properties').remove();


  const isAbsoluteOrInlineUrl = (value: string | undefined) => {
    if (!value || typeof value !== 'string') return false;
    const lowered = value.toLowerCase();
    return (
      lowered.startsWith('data:') ||
      lowered.startsWith('blob:') ||
      lowered.startsWith('http:') ||
      lowered.startsWith('https:') ||
      value.startsWith('/')
    );
  };

  const decodeSafe = (value: string) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };

  const normalizeCandidate = (value: string) => {
    let normalized = value;
    while (normalized.startsWith('./')) {
      normalized = normalized.slice(2);
    }
    return normalized;
  };

  const baseUrl = portableCustomInteraction.attr('data-base-url') || '';
  const contentAssetMap = new Map<string, string>();
  Object.entries(portableCustomInteraction.get(0)?.attribs || {}).forEach(([name, value]) => {
    if (!name.startsWith('data-content-')) return;
    const key = name.substring('data-content-'.length);
    if (!key || typeof value !== 'string' || !value.length) return;
    contentAssetMap.set(key, value);
  });

  const resolveAsset = (source: string) => {
    if (!source || typeof source !== 'string') return source;
    if (isAbsoluteOrInlineUrl(source)) return source;

    const candidates = [source, decodeSafe(source)]
      .map(normalizeCandidate)
      .filter((value, index, self) => value && self.indexOf(value) === index);

    for (const candidate of candidates) {
      const exact = contentAssetMap.get(candidate);
      if (exact) return exact;

      const basename = candidate.split('/').pop();
      if (basename) {
        const byName = contentAssetMap.get(basename);
        if (byName) return byName;
      }
    }

    if (baseUrl) {
      return `${baseUrl.replace(/\/+$/, '')}/${source.replace(/^\/+/, '')}`;
    }

    return source;
  };

  Object.entries(portableCustomInteraction.get(0)?.attribs || {}).forEach(([name, value]) => {
    if (!name.startsWith('data-') || typeof value !== 'string') return;
    if (!/<[a-z][\s\S]*>/i.test(value)) return;

    const resolved = value.replace(/\b(src|href|data)=["']([^"']+)["']/gi, (_all, attr, url) => {
      const nextUrl = resolveAsset(url);
      return `${attr}="${nextUrl}"`;
    });

    if (resolved !== value) {
      portableCustomInteraction.attr(name, resolved);
    }
  });

  const getOrAddModules = () => {
    let modules = portableCustomInteraction.find('qti-interaction-modules');
    if (modules.length === 0) {
      portableCustomInteraction.prepend('<qti-interaction-modules></qti-interaction-modules>');
      modules = portableCustomInteraction.find('qti-interaction-modules');
    }
    return modules;
  };

  // -----------------------------------------------------------------------------------------------
  // Move libraries to qti-interaction-modules
  // -----------------------------------------------------------------------------------------------
  const libraries = portableCustomInteraction.find('libraries');
  if (libraries.length > 0) {
    const modules = getOrAddModules();
    libraries.find('lib').each((_, module) => {
      const id = $(module).attr('id'); // Get the id up to the first slash
      // check if the module already exists
      if (modules.find(`qti-interaction-module[id="${id}"]`).length === 0 && id) {
        const newModule = $('<qti-interaction-module></qti-interaction-module>');
        newModule.attr('id', id);
        newModule.attr('primary-path', id);
        modules.append(newModule);
      }
    });
  }
  // -----------------------------------------------------------------------------------------------
  // Add module attribute to qti-portable-custom-interaction
  // -----------------------------------------------------------------------------------------------
  const customInteractionTypeIdentifier = portableCustomInteraction.attr('custom-interaction-type-identifier');
  let module = portableCustomInteraction.attr('module');
  if (!module) {
    portableCustomInteraction.attr('module', customInteractionTypeIdentifier);
    module = customInteractionTypeIdentifier;
  }
  if (portableCustomInteraction.attr('hook')) {
    const qtiModules = getOrAddModules();
    const newModule = $('<qti-interaction-module></qti-interaction-module>');
    newModule.attr('id', module);
    newModule.attr('primary-path', portableCustomInteraction.attr('hook'));
    qtiModules.append(newModule);
  }
  portableCustomInteraction.removeAttr('hook');

  // -----------------------------------------------------------------------------------------------
  // Fix tagnames and structure
  // Change <modules> to <qti-interaction-modules> and <module> to <qti-interaction-module>
  // -----------------------------------------------------------------------------------------------
  const modules = portableCustomInteraction.find('modules');
  if (modules.length > 0) {
    modules.find('module').each((_, module) => {
      const qtiModules = getOrAddModules();
      const newModule = $('<qti-interaction-module></qti-interaction-module>');
      const id = $(module).attr('id')?.split('/')[0]; // Get the id up to the first slash
      newModule.attr('id', id || '');
      newModule.attr('primary-path', $(module).attr('primary-path'));
      qtiModules.append(newModule);
    });
    modules.remove();
  }

  // -----------------------------------------------------------------------------
  // Convert resources -> stylesheets links to qti-stylesheet under portable interaction
  // -----------------------------------------------------------------------------
  const resourceNodes = portableCustomInteraction.find('resources');

  if (resourceNodes.length > 0) {
    const stylesheets = resourceNodes.find('stylesheets');

    if (stylesheets.length > 0) {
      stylesheets.find('link').each((_, stylesheet) => {
        const href = $(stylesheet).attr('href');
        if (!href) return;

        const newStylesheet = $('<qti-stylesheet></qti-stylesheet>');
        newStylesheet.attr('href', href);

        const type = $(stylesheet).attr('type');
        if (type) {
          newStylesheet.attr('type', type);
        } else {
          newStylesheet.attr('type', 'text/css');
        }

        const media = $(stylesheet).attr('media');
        if (media) newStylesheet.attr('media', media);

        const title = $(stylesheet).attr('title');
        if (title) newStylesheet.attr('title', title);

        portableCustomInteraction.append(newStylesheet);
      });

      stylesheets.remove();
    }
  }

  // --------------------------------
  // Remove data-base-* attributes
  // --------------------------------
  portableCustomInteraction.removeAttr('data-base-ref');
  portableCustomInteraction.removeAttr('data-base-item');
  portableCustomInteraction.removeAttr('data-base-url');

  // // --------------------------------------------------------------------------------------------------------
  // // Fix the id of the qti-interaction-module to be the value of custom-interaction-type-identifier
  // // --------------------------------------------------------------------------------------------------------
  // if (customInteractionTypeIdentifier) {
  //   portableCustomInteraction.find('qti-interaction-module').attr('id', customInteractionTypeIdentifier);

  //   // Add the module attribute with the same value as custom-interaction-type-identifier
  //   portableCustomInteraction.attr('module', customInteractionTypeIdentifier);
  // }

  // -------------------------------------------------------------------------------------------------
  // Copy response-identifier from qti-custom-interaction to qti-portable-custom-interaction
  // -------------------------------------------------------------------------------------------------
  const responseIdentifier = customInteraction.attr('response-identifier');
  if (responseIdentifier) {
    portableCustomInteraction.attr('response-identifier', responseIdentifier);
  }

  // -------------------------------------------------------------------------------------------------
  // Rename <markup> to <qti-interaction-markup>
  // -------------------------------------------------------------------------------------------------
  const markup = portableCustomInteraction.find('markup');
  if (markup.length > 0) {
    markup.replaceWith('<qti-interaction-markup>' + markup.html() + '</qti-interaction-markup>');
  }

  // ----------------------------------------------------------------------------
  // Remove the qti-custom-interaction wrapper
  // ----------------------------------------------------------------------------
  const newPortableCustomInteraction = portableCustomInteraction.clone();
  customInteraction.replaceWith(newPortableCustomInteraction);

  // -------------------------------------------------------------------------------------------------
  // Remove resources (qti-resources or resources) from the qti-portable-custom-interaction
  // -------------------------------------------------------------------------------------------------
  const resources = newPortableCustomInteraction.find('qti-resources, resources');
  resources.remove();

  return $;
}
