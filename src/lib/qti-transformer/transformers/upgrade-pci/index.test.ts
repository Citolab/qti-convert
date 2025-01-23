import { expect, test } from 'vitest';

import { upgradePci } from '.';
import { qtiTransform } from '../../qti-transform';
import { areXmlEqual } from '../utils-node-only';

const xml = String.raw;

const transformObjectTags = (xmlContent: string) => {
  const modifiedContent = qtiTransform(xmlContent)
    .fnCh($ => upgradePci($, ''))
    .xml();
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
                            <property key="kebabCase">true</property>
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
                data-kebab-case="true"
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

test('upgrade tao exported pci with 2 levels', async () => {
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
   <qti-custom-interaction response-identifier="RESPONSE"
                    data-base-ref="https://europe-west4-qti-convert.cloudfunctions.net/api/application/convert-online/package/b11f2f15259a9289eab9ff1c8bb6b94bd503914b62da22668547d27855b5df5a"
                    data-base-item="https://europe-west4-qti-convert.cloudfunctions.net/api/application/convert-online/package/b11f2f15259a9289eab9ff1c8bb6b94bd503914b62da22668547d27855b5df5a">
                    <qti-portable-custom-interaction
                        custom-interaction-type-identifier="colorProportions" data-version="1.0.1"
                        data-base-url="https://europe-west4-qti-convert.cloudfunctions.net/api/application/convert-online/package/b11f2f15259a9289eab9ff1c8bb6b94bd503914b62da22668547d27855b5df5a">
            <properties>
              <properties key="data">
                <properties key="0">
                  <property key="stimulusindex">1</property>
                  <property key="stimulus">5 + 7 = 12</property>
                  <property key="response">1
</property>
                </properties>
                <properties key="1">
                  <property key="stimulusindex">2</property>
                  <property key="stimulus">4 + 4 = 9</property>
                  <property key="response">2
</property>
                </properties>
                <properties key="2">
                  <property key="stimulusindex">3</property>
                  <property key="stimulus">7 + 6 = 13</property>
                  <property key="response">1</property>
                </properties>
              <property key="uploadedFname">stimuli_IIL_item.csv</property>
              <property key="feedback">true</property>
              <property key="shufflestimuli"></property>
              <property key="respkey"></property>
              <property key="tlimit">0</property>
              <property key="level">2</property>
              <property key="buttonlabel0">True</property>
              <property key="buttonlabel1">False</property>
              <property key="buttonlabel2"></property>
              <property key="buttonlabel3"></property>
              <property key="buttonlabel4"></property>
              <property key="buttonlabel5"></property>
              <property key="buttonlabel6"></property>
              <property key="buttonlabel7"></property>
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
<qti-portable-custom-interaction custom-interaction-type-identifier="colorProportions" data-version="1.0.1" data-data__0__stimulusindex="1" data-data__0__stimulus="5 + 7 = 12" data-data__0__response="1" data-data__1__stimulusindex="2" data-data__1__stimulus="4 + 4 = 9" data-data__1__response="2" data-data__2__stimulusindex="3" data-data__2__stimulus="7 + 6 = 13" data-data__2__response="1" data-data__uploaded-fname="stimuli_IIL_item.csv" data-data__feedback="true" data-data__shufflestimuli="" data-data__respkey="" data-data__tlimit="0" data-data__level="2" data-data__buttonlabel0="True" data-data__buttonlabel1="False" data-data__buttonlabel2="" data-data__buttonlabel3="" data-data__buttonlabel4="" data-data__buttonlabel5="" data-data__buttonlabel6="" data-data__buttonlabel7="" data-0__stimulusindex="1" data-0__stimulus="5 + 7 = 12" data-0__response="1" data-1__stimulusindex="2" data-1__stimulus="4 + 4 = 9" data-1__response="2" data-2__stimulusindex="3" data-2__stimulus="7 + 6 = 13" data-2__response="1" data-uploaded-fname="stimuli_IIL_item.csv" data-feedback="true" data-shufflestimuli="" data-respkey="" data-tlimit="0" data-level="2" data-buttonlabel0="True" data-buttonlabel1="False" data-buttonlabel2="" data-buttonlabel3="" data-buttonlabel4="" data-buttonlabel5="" data-buttonlabel6="" data-buttonlabel7="" data-stimulusindex="3" data-stimulus="7 + 6 = 13" data-response="1" module="colorProportions" response-identifier="RESPONSE">
</qti-portable-custom-interaction>`;
  const result = await transformObjectTags(input);
  console.log(result);
  const areEqual = await areXmlEqual(result, expectedOutput);
  expect(areEqual).toEqual(true);
});
