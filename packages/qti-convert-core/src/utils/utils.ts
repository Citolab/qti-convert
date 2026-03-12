import * as cheerio from 'cheerio';

export const kebabToDashedNotation = (input: string): string => {
  // Use a regular expression to find uppercase letters and replace them with a dash followed by the lowercase equivalent
  return input.replace(/[A-Z]/g, match => '-' + match.toLowerCase());
};

export const toDefaultNamespace = ($rootElement: cheerio.CheerioAPI) => {
  const root = $rootElement.root().children().first();
  const rootName = root[0].tagName;

  if (rootName.includes(':')) {
    const [prefix, tag] = rootName.split(':');
    root.prop('tagName', tag);
    root.removeAttr(`xmlns:${prefix}`);
    const pdNamespace = root.attr('xmlns');
    root.attr('xmlns', `http://www.imsglobal.org/xsd/imscp_v1p1`);
    if (pdNamespace) {
      // set previous default namespace
      root.attr('xmlns:pd', pdNamespace);
    }

    // // Fix child elements
    $rootElement('*').each((i, elem) => {
      if (elem.type !== 'tag') return;
      if (!elem.tagName.includes(`:`) && !(elem === root[0]) && pdNamespace) {
        elem.tagName = `pd:${elem.tagName}`;
      } else if (elem.tagName.startsWith(`${prefix}:`)) {
        const [, tag] = elem.tagName.split(':');
        elem.tagName = tag;
      }
    });
  }
};
