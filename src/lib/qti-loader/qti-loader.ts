import * as cheerio from 'cheerio';

/**
 * Fetches an IMS manifest XML file from the given href and returns the first resource element with type "imsqti_test_xmlv3p0".
 * @param href - The URL of the IMS manifest XML file.
 * @returns The first resource element with type "imsqti_test_xmlv3p0".
 */
const testFromImsmanifest = async href => {
  const response = await fetch(href);
  const imsmanifestXML = await response.text();
  //   await new Promise<void>(r => setTimeout(() => r(), 1000)); // Add some delay for demo purposes
  const $ = cheerio.load(imsmanifestXML, { xmlMode: true, xml: { xmlMode: true } });
  const el = $('resource[type="imsqti_test_xmlv3p0"]').first();
  return el;
};

const xmlFromAssessmentTest = async (href: string): Promise<cheerio.CheerioAPI> => {
  const response = await fetch(href);
  const assessmentTestXML = await response.text();
  //   await new Promise<void>(r => setTimeout(() => r(), 1000)); // Add some delay for demo purposes
  const $ = cheerio.load(assessmentTestXML, { xmlMode: true, xml: { xmlMode: true } });
  return $;
};

/**
 * Retrieves items from an assessment test.
 * @param href - The URL of the assessment test.
 * @returns A Promise that resolves to an array of objects containing the identifier, href, and category of each item.
 */
const itemsFromAssessmentTest = async (
  xmlCheerio: cheerio.CheerioAPI
): Promise<{ identifier: string; href: string; category: string }[]> => {
  const items: { identifier: string; href: string; category: string }[] = [];
  xmlCheerio('qti-assessment-item-ref').each((_, element) => {
    const identifier = xmlCheerio(element).attr('identifier')!;
    const href = xmlCheerio(element).attr('href')!;
    const category = xmlCheerio(element).attr('category');
    items.push({ identifier, href, category });
  });
  return items;
};

let _controller = new AbortController();

/**
 * Requests an XML item from the specified URL.
 * @param href - The URL of the XML item to request.
 * @returns A Promise that resolves to the XML item as a string.
 */
export async function requestItem(href: string, abortable: boolean = true) {
  const fetchXml = async (href: string): Promise<string> => {
    try {
      const xmlFetch = abortable ? await fetch(href, { signal }) : await fetch(href);
      const xmlText = await xmlFetch.text();
      return xmlText;
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('Fetch aborted');
      } else {
        console.error(error);
      }
    }
    return '';
  };
  let signal;
  if (abortable) {
    _controller?.abort();
    _controller = new AbortController();
    signal = _controller.signal;
  }
  return await fetchXml(href);
}

export type ManifestData = {
  itemLocation: string;
  testIdentifier: string;
  assessmentXML?: string;
  assessmentLocation: string;
  items: {
    identifier: string;
    href: string;
    category: string;
  }[];
};

/**
 * Fetches manifest data for a given package URI.
 * @param manifestUri The URI of the package to fetch manifest data for.
 * @returns A Promise that resolves to a ManifestData object.
 */
export const testLoader = async (manifestUri: string): Promise<ManifestData> => {
  const assessmentTestEl = await testFromImsmanifest(manifestUri);

  const uri = manifestUri.substring(0, manifestUri.lastIndexOf('/')) + '/' + assessmentTestEl.attr('href');
  const xmlCheerio = await xmlFromAssessmentTest(uri);
  const items = await itemsFromAssessmentTest(xmlCheerio);

  const assessmentLocation = `${uri.substring(0, uri.lastIndexOf('/'))}`;
  const itemLocation = `${assessmentLocation}/${items[0].href.substring(0, items[0].href.lastIndexOf('/'))}`;
  return {
    assessmentXML: xmlCheerio.xml(),
    itemLocation,
    assessmentLocation,
    items,
    testIdentifier: assessmentTestEl.attr('identifier')!
  };
};
