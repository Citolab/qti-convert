import { replaceReferencedTags } from './qti-helper';
import { expect, test } from 'vitest';
test('text media interaction removed ', async () => {
  const input = `<?xml version="1.0" encoding="utf-8"?>
<assessmentItem xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema" timeDependent="false"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imsqti_v2p1 ../controlxsds/imsqti_v2p1.xsd"
  adaptive="false" title="P22N51-02-00" identifier="ITM-n21797"
  xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1">
  <responseDeclaration baseType="integer" cardinality="single" identifier="VIDEORESPONSE"
    xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1" />
  <outcomeDeclaration cardinality="single" identifier="ItemFunctionalType" baseType="string">
    <defaultValue>
      <value>Informational</value>
    </defaultValue>
  </outcomeDeclaration>
  <stylesheet href="../css/cito_userstyle.css" type="text/css" />
  <stylesheet href="../css/cito_generated.css" type="text/css" />
  <itemBody class="defaultBody">
    <div class="content">

      <div class="itemcontainer">
        <div class="itemcontent">
          <div class="questify_contextWrapper">

            <br /><span class="cito_genclass_n21797_1" /><div class="cito_genclass_n21797_2"><mediaInteraction
                class="questify_videoWrapper hasControls showCurrentTime showDuration clickToPlay"
                id="I6b59bf99-30c3-45b3-98ba-b32d8be00e27" responseIdentifier="VIDEORESPONSE"
                autostart="false" maxPlays="0">
                <object type="video/mp4" data="../video/P22N51-02-00.mp4" height="270" width="480" />
              </mediaInteraction></div><span
              class="cito_genclass_n21797_3"></span><br />

          </div>
        </div>
      </div>
    </div>
  </itemBody>
</assessmentItem>`;

  const result = await replaceReferencedTags(input.toString(), ['P22N51-02-00.mp4']);

  expect(result.includes('mediaInteraction')).toEqual(false);
});
