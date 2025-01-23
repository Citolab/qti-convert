import * as cheerio from 'cheerio';
import { kebabToDashedNotation } from 'src/lib/utils/utils';

export function upgradePci($: cheerio.CheerioAPI, baseUrl: string): cheerio.CheerioAPI {
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
  portableCustomInteraction.find('properties').each((_, root) => {
    parseProperties(root);
  });
  portableCustomInteraction.find('properties').remove();

  // -----------------------------------------------------------------------------------------------
  // Fix tagnames and structure
  // Change <modules> to <qti-interaction-modules> and <module> to <qti-interaction-module>
  // -----------------------------------------------------------------------------------------------
  const modules = portableCustomInteraction.find('modules');
  if (modules.length > 0) {
    const newModules = $('<qti-interaction-modules></qti-interaction-modules>');
    modules.find('module').each((_, module) => {
      const newModule = $('<qti-interaction-module></qti-interaction-module>');
      const id = $(module).attr('id')?.split('/')[0]; // Get the id up to the first slash
      newModule.attr('id', id || '');
      newModule.attr('primary-path', $(module).attr('primary-path'));
      newModules.append(newModule);
    });
    modules.replaceWith(newModules);
  }

  // --------------------------------------------------------------------------
  // Hooks to modules and set base-url to be able to find the resources
  // --------------------------------------------------------------------------
  const attributes = ['hook', 'module'];
  const documentPath = baseUrl.substring(0, baseUrl.lastIndexOf('/'));
  for (const attribute of attributes) {
    const srcAttributes = $('[' + attribute + ']');
    srcAttributes.each((_, node) => {
      const $node = $(node);
      const srcValue = $node.attr(attribute);

      if (srcValue && !srcValue.startsWith('data:') && !srcValue.startsWith('http')) {
        // Set attributes using Cheerio methods
        $node.attr('base-url', baseUrl);
        $node.attr('module', `${documentPath}/${encodeURI(srcValue + (srcValue.endsWith('.js') ? '' : '.js'))}`);
      }
    });
  }

  // --------------------------------
  // Remove data-base-* attributes
  // --------------------------------
  portableCustomInteraction.removeAttr('data-base-ref');
  portableCustomInteraction.removeAttr('data-base-item');
  portableCustomInteraction.removeAttr('data-base-url');

  // --------------------------------------------------------------------------------------------------------
  // Fix the id of the qti-interaction-module to be the value of custom-interaction-type-identifier
  // --------------------------------------------------------------------------------------------------------
  const customInteractionTypeIdentifier = portableCustomInteraction.attr('custom-interaction-type-identifier');
  if (customInteractionTypeIdentifier) {
    portableCustomInteraction.find('qti-interaction-module').attr('id', customInteractionTypeIdentifier);

    // Add the module attribute with the same value as custom-interaction-type-identifier
    portableCustomInteraction.attr('module', customInteractionTypeIdentifier);
  }

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
