import { expect, test } from 'vitest';

import { objectToAudio } from '.';
import { qtiTransform } from '../../qti-transform';
import { areXmlEqual } from '../utils-node-only';

const xml = String.raw;

const transformObjectTags = (xmlContent: string) => {
  const modifiedContent = qtiTransform(xmlContent).fnCh(objectToAudio).xml();
  return modifiedContent;
};

test('transform object type="audio to audio tag', async () => {
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
    <qti-media-interaction response-identifier="AUDIORESPONSE" autostart="false" max-plays="0" id="I6f9b9b94-5a79-477a-a462-19db78f7ebf1">
      <object type="audio/ogg" data="../audio/India_BB.opus" height="28"
								width="240" data-dep-description="" data-dep-controls="true"
								data-dep-controlslist="start pause stop scroll" />
    </qti-media-interaction>
`;
  const expectedOutput = xml`<?xml version="1.0" encoding="UTF-8"?>
    <qti-media-interaction response-identifier="AUDIORESPONSE" autostart="false" max-plays="0" id="I6f9b9b94-5a79-477a-a462-19db78f7ebf1">
      <audio width="240" height="28" controls="true" >
        <source src="../audio/India_BB.opus" type="audio/ogg" />
      </audio>
    </qti-media-interaction>`;
  const result = await transformObjectTags(input);
  const areEqual = await areXmlEqual(result, expectedOutput);
  expect(areEqual).toEqual(true);
});
