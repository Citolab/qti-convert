import * as cheerio from 'cheerio';
import { kebabToDashedNotation } from 'src/lib/utils/utils';

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
  portableCustomInteraction.find('properties').each((_, root) => {
    parseProperties(root);
  });
  portableCustomInteraction.find('properties').remove();

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
  // Move resources -> stylesheets to qti-assessment-item => qti-stylesheets
  // -----------------------------------------------------------------------------
  const assessmentItem = portableCustomInteraction.closest('qti-assessment-item'); // Find the closest qti-assessment-item

  if (assessmentItem.length > 0) {
    const resources = portableCustomInteraction.find('resources');

    if (resources.length > 0) {
      const stylesheets = resources.find('stylesheets');

      if (stylesheets.length > 0) {
        // Create a new <qti-stylesheets> element
        stylesheets.find('link').each((_, stylesheet) => {
          const href = $(stylesheet).attr('href'); // Get the href attribute from the <stylesheet>
          if (href) {
            const newStylesheet = $('<qti-stylesheet></qti-stylesheet>');
            newStylesheet.attr('href', href);
            newStylesheet.attr('type', 'text/css');
            assessmentItem.prepend(newStylesheet); // Append to <qti-stylesheets>
          }
        });

        // Remove the original <resources> element or just <stylesheet> if needed
        stylesheets.remove();
      }
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
