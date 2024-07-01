import { expect, test } from 'vitest';

import { objectToVideo } from '.';
import { qtiTransform } from '../../qti-transform';
import { areXmlEqual } from '../utils';

const xml = String.raw;

const transformObjectTags = (xmlContent: string) => {
  const modifiedContent = qtiTransform(xmlContent).fnCh(objectToVideo).xml();
  return modifiedContent;
};

test('transform object type="video to video tag', async () => {
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
    <qti-media-interaction response-identifier="VIDEORESPONSE" autostart="false" max-plays="0" id="I6f9b9b94-5a79-477a-a462-19db78f7ebf1">
      <object type="video/webm" data="../video/BB_14a_T_WebM_Facet384x288.webm" height="288" width="384" data-dep-description="" data-dep-controls="true" data-dep-controlslist="start pause stop scroll" />
    </qti-media-interaction>
`;
  const expectedOutput = xml`<?xml version="1.0" encoding="UTF-8"?>
    <qti-media-interaction response-identifier="VIDEORESPONSE" autostart="false" max-plays="0" id="I6f9b9b94-5a79-477a-a462-19db78f7ebf1">
      <video width="384" height="288" controls="true">
        <source src="../video/BB_14a_T_WebM_Facet384x288.webm" type="video/webm" />
      </video>
    </qti-media-interaction>

`;
  const result = await transformObjectTags(input);
  const areEqual = await areXmlEqual(result, expectedOutput);
  expect(areEqual).toEqual(true);
});
