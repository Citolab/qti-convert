import * as cheerio from 'cheerio';

export interface ModuleResolutionConfig {
  waitSeconds?: number;
  context?: string;
  catchError?: boolean;
  paths: {
    [key: string]: string | string[];
  };
  shim?: {
    [key: string]: {
      deps?: string[]; // Array of dependencies
      exports?: string; // The global variable to use as the module's value
    };
  };
}

export async function configurePciAsync(
  $: cheerio.CheerioAPI,
  getModuleResolutionConfig: (url: string) => Promise<ModuleResolutionConfig>
) {
  await configurePCI($, getModuleResolutionConfig);
  return $;
}

// To support PCI's with module module_resolution.js and fallback_module_resolution.js you need to call this function.
// It will retrieve these files from the package and add them to the qti-interaction-modules
// Also, if there are multiple pci's with the same custom-interaction-type-identifier we'll make them unique.
async function configurePCI(
  $: cheerio.CheerioAPI,
  getModuleResolutionConfig: (url: string) => Promise<ModuleResolutionConfig>
) {
  const customInteractionTypeIdentifiers: string[] = [];
  const portableCustomInteractions = $('qti-portable-custom-interaction');
  const moduleResolutionConfig = await getModuleResolutionConfig('/modules/module_resolution.js');
  const moduleResolutionFallbackConfig = await getModuleResolutionConfig('/modules/fallback_module_resolution.js');
  if (portableCustomInteractions.length > 0) {
    for (const interaction of portableCustomInteractions) {
      let customInteractionTypeIdentifier = $(interaction).attr('custom-interaction-type-identifier');
      if (customInteractionTypeIdentifiers.includes(customInteractionTypeIdentifier)) {
        customInteractionTypeIdentifier = customInteractionTypeIdentifier + customInteractionTypeIdentifiers.length;
        $(interaction).attr('custom-interaction-type-identifier', customInteractionTypeIdentifier);
        customInteractionTypeIdentifiers.push(customInteractionTypeIdentifier);
      }
      customInteractionTypeIdentifiers.push(customInteractionTypeIdentifier);

      if (moduleResolutionConfig) {
        // add this configuration to the portable custom interactions like:
        //    <qti-interaction-modules>
        //      <qti-interaction-module fallback-path="modules/shading_fallback.js" id="shading" primary-path="modules/shading.js"/>
        // This makes it easier in the player because otherwise the player has to check for the existence of the module_resolution.js and fallback_module_resolution.js

        if ($(interaction).find('qti-interaction-modules').length === 0) {
          $(interaction).append('<qti-interaction-modules></qti-interaction-modules>');
        }
        for (const module in moduleResolutionConfig.paths) {
          const path = moduleResolutionConfig.paths[module];
          let fallbackPath: string | string[] = '';
          if (
            moduleResolutionFallbackConfig &&
            moduleResolutionFallbackConfig.paths &&
            moduleResolutionFallbackConfig.paths[module]
          ) {
            fallbackPath = moduleResolutionConfig.paths[module];
          }
          const primaryArray = Array.isArray(path) ? path : [path];
          const fallbackPathArray = Array.isArray(fallbackPath) ? fallbackPath : [fallbackPath];
          // create an array with primary and fallback paths.
          const paths = primaryArray.map((primaryPath, i) => {
            const fallbackPath = fallbackPathArray.length > i ? fallbackPathArray[i] : '';
            return {
              primaryPath,
              fallbackPath
            };
          });
          // check if all fallbackPath elements are in the array: paths, otherwise add
          for (const fallbackPath of fallbackPathArray) {
            if (!paths.some(p => p.fallbackPath === fallbackPath)) {
              paths.push({
                primaryPath: primaryArray.length > 0 ? primaryArray[0] : fallbackPath,
                fallbackPath
              });
            }
          }
          // add the paths to the qti-interaction-modules
          for (const path of paths) {
            $(interaction)
              .find('qti-interaction-modules')
              .append(
                `<qti-interaction-module ${
                  path.fallbackPath ? `fallback-path="${path.fallbackPath}"` : ''
                } id="${module}" primary-path="${path.primaryPath}"/>`
              );
          }
        }
      }
    }
  }
}
