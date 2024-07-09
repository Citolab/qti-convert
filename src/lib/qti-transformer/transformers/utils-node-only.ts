import * as xml2js from 'xml2js';

export async function areXmlEqual(xml1: string, xml2: string): Promise<boolean> {
  const parser = new xml2js.Parser({
    ignoreAttrs: false,
    trim: true,
    normalize: false,
    pretty: true,
    indent: '  ',
    newline: '\n',
    allowEmpty: true
  });

  try {
    const obj1 = await parser.parseStringPromise(xml1);
    const obj2 = await parser.parseStringPromise(xml2);

    const ob1String = JSON.stringify(obj1);
    const ob2String = JSON.stringify(obj2);

    return ob1String === ob2String;
  } catch (error) {
    console.error('Error parsing XML:', error);
    return false;
  }
}
