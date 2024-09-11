import { expect, test } from 'vitest';

import { upgradePci } from '.';
import { qtiTransform } from '../../qti-transform';
import { areXmlEqual } from '../utils-node-only';

const xml = String.raw;

const transformObjectTags = (xmlContent: string) => {
  const modifiedContent = qtiTransform(xmlContent).fnCh(upgradePci).xml();
  return modifiedContent;
};

test('upgrade tao exported pci', async () => {
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
   <qti-custom-interaction response-identifier="RESPONSE"
                    data-base-ref="https://europe-west4-qti-convert.cloudfunctions.net/api/application/convert-online/package/b11f2f15259a9289eab9ff1c8bb6b94bd503914b62da22668547d27855b5df5a"
                    data-base-item="https://europe-west4-qti-convert.cloudfunctions.net/api/application/convert-online/package/b11f2f15259a9289eab9ff1c8bb6b94bd503914b62da22668547d27855b5df5a">
                    <qti-portable-custom-interaction
                        custom-interaction-type-identifier="colorProportions" data-version="1.0.1"
                        data-base-url="https://europe-west4-qti-convert.cloudfunctions.net/api/application/convert-online/package/b11f2f15259a9289eab9ff1c8bb6b94bd503914b62da22668547d27855b5df5a">
                        <properties>
                            <property key="colors">red, blue, yellow</property>
                            <property key="width">400</property>
                            <property key="height">400</property>
                        </properties>
                        <modules>
                            <module id="colorProportions/interaction/runtime/js/index"
                                primary-path="http://localhost:3333/application/convert-online/package/b11f2f15259a9289eab9ff1c8bb6b94bd503914b62da22668547d27855b5df5a/interaction/runtime/js/index.js" />
                        </modules>
                        <markup>
                            <div class="pciInteraction">
                                <style>.pciInteraction ul.pci{
                                    list-style-type: none;
                                    margin: 0 5px;
                                    padding: 0;
                                    display: inline-block;
                                    position: relative;
                                    top: 7px;
                                    }
                                    .pciInteraction ul.pci li{
                                    float: left;
                                    text-align: left;
                                    list-style-type: none;
                                    }</style>
                                <div class="prompt" />
                                <ul class="pci" />
                            </div>
                        </markup>
                    </qti-portable-custom-interaction>
                </qti-custom-interaction>
`;
  const expectedOutput = xml`<?xml version="1.0" encoding="UTF-8"?>
              <qti-portable-custom-interaction
                custom-interaction-type-identifier="colorProportions"
                data-version="1.0.1"
                data-colors="red, blue, yellow"
                data-width="400"
                data-height="400"
                module="colorProportions"
                response-identifier="RESPONSE"
                >
                    <qti-interaction-modules>
                        <qti-interaction-module
                            id="colorProportions"
                            primary-path="http://localhost:3333/application/convert-online/package/b11f2f15259a9289eab9ff1c8bb6b94bd503914b62da22668547d27855b5df5a/interaction/runtime/js/index.js"
                        ></qti-interaction-module>
                    </qti-interaction-modules>
                    <qti-interaction-markup>
                        <div class="pciInteraction">
                            <div class="prompt" />
                            <ul class="pci" />
                        </div>
                    </qti-interaction-markup>
                </qti-portable-custom-interaction>`;
  const result = await transformObjectTags(input);
  const areEqual = await areXmlEqual(result, expectedOutput);
  expect(areEqual).toEqual(true);
});
