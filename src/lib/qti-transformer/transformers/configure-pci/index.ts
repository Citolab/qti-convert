import * as cheerio from 'cheerio';

export interface ModuleResolutionConfig {
  waitSeconds?: number;
  context?: string;
  catchError?: boolean;
  urlArgs?: string;
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
  baseUrl: string,
  getModuleResolutionConfig: (url: string) => Promise<ModuleResolutionConfig>
) {
  await configurePCI($, baseUrl, getModuleResolutionConfig);
  return $;
}

// To support PCI's with module module_resolution.js and fallback_module_resolution.js you need to call this function.
// It will retrieve these files from the package and add them to the qti-interaction-modules
// Also, if there are multiple pci's with the same custom-interaction-type-identifier we'll make them unique.
async function configurePCI(
  $: cheerio.CheerioAPI,
  baseUrl: string,
  getModuleResolutionConfig: (url: string) => Promise<ModuleResolutionConfig>
) {
  const customInteractionTypeIdentifiers: string[] = [];
  const portableCustomInteractions = $('qti-portable-custom-interaction');
  const moduleResolutionConfig = await getModuleResolutionConfig('/modules/module_resolution.js');
  const moduleResolutionFallbackConfig = await getModuleResolutionConfig('/modules/fallback_module_resolution.js');

  if (portableCustomInteractions.length > 0) {
    for (const interaction of portableCustomInteractions) {
      // set data-base-url
      $(interaction).attr('data-base-url', baseUrl);
      let customInteractionTypeIdentifier = $(interaction).attr('custom-interaction-type-identifier');
      if (customInteractionTypeIdentifiers.includes(customInteractionTypeIdentifier)) {
        customInteractionTypeIdentifier = customInteractionTypeIdentifier + customInteractionTypeIdentifiers.length;
        $(interaction).attr('custom-interaction-type-identifier', customInteractionTypeIdentifier);
        customInteractionTypeIdentifiers.push(customInteractionTypeIdentifier);
      }
      customInteractionTypeIdentifiers.push(customInteractionTypeIdentifier);

      // Check if qti-interaction-modules already exists
      const existingModulesElement = $(interaction).find('qti-interaction-modules');

      // If it exists and has primary-configuration, handle that format
      if (existingModulesElement.length > 0 && existingModulesElement.attr('primary-configuration')) {
        const primaryConfigPath = existingModulesElement.attr('primary-configuration');
        if (primaryConfigPath) {
          try {
            // Load the primary configuration
            const primaryConfig = await getModuleResolutionConfig(`/${primaryConfigPath}`);

            // Get existing module elements that only have id attributes
            const existingModules = existingModulesElement.find('qti-interaction-module');

            // Update existing modules with paths from config
            existingModules.each((_, moduleEl) => {
              const moduleId = $(moduleEl).attr('id');
              if (moduleId && primaryConfig.paths && primaryConfig.paths[moduleId]) {
                const primaryPath = primaryConfig.paths[moduleId];
                const primaryPathString = Array.isArray(primaryPath) ? primaryPath[0] : primaryPath;
                $(moduleEl).attr('primary-path', primaryPathString);

                // Check for fallback path
                if (
                  moduleResolutionFallbackConfig &&
                  moduleResolutionFallbackConfig.paths &&
                  moduleResolutionFallbackConfig.paths[moduleId]
                ) {
                  const fallbackPath = moduleResolutionFallbackConfig.paths[moduleId];
                  const fallbackPathString = Array.isArray(fallbackPath) ? fallbackPath[0] : fallbackPath;
                  $(moduleEl).attr('fallback-path', fallbackPathString);
                }
              }
            });

            // Add any additional modules from primary config that aren't already present
            if (primaryConfig.paths) {
              for (const moduleId in primaryConfig.paths) {
                const existingModule = existingModulesElement.find(`qti-interaction-module[id="${moduleId}"]`);
                if (existingModule.length === 0) {
                  const primaryPath = primaryConfig.paths[moduleId];
                  const primaryPathString = Array.isArray(primaryPath) ? primaryPath[0] : primaryPath;

                  let fallbackPathAttr = '';
                  if (
                    moduleResolutionFallbackConfig &&
                    moduleResolutionFallbackConfig.paths &&
                    moduleResolutionFallbackConfig.paths[moduleId]
                  ) {
                    const fallbackPath = moduleResolutionFallbackConfig.paths[moduleId];
                    const fallbackPathString = Array.isArray(fallbackPath) ? fallbackPath[0] : fallbackPath;
                    fallbackPathAttr = ` fallback-path="${fallbackPathString}"`;
                  }

                  existingModulesElement.append(
                    `<qti-interaction-module id="${moduleId}" primary-path="${primaryPathString}"${fallbackPathAttr}/>`
                  );
                }
              }
            }

            // Apply urlArgs if present in config
            if (primaryConfig.urlArgs) {
              existingModulesElement.attr('url-args', primaryConfig.urlArgs);
            }
          } catch (error) {
            console.warn(`Failed to load primary configuration: ${primaryConfigPath}`, error);
          }
        }
      } else {
        // Original logic for when there's no existing qti-interaction-modules or no primary-configuration
        if (moduleResolutionConfig) {
          // Create qti-interaction-modules if it doesn't exist
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
              fallbackPath = moduleResolutionFallbackConfig.paths[module];
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
}
