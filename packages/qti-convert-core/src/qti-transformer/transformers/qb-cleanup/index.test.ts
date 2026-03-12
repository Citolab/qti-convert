import { expect, test } from 'vitest';

import { qtiTransform } from '../../qti-transform';
import { areXmlEqual } from '../utils-node-only';

const xml = String.raw;
test('cleanup QB qti', async () => {
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
  <qti-item-body class="defaultBody" xml:lang="nl-NL">
    <div class="content">
        <div class="qti-layout-row">
            <div class="qti-layout-col6">
                <div id="leftbody">
                    <p>
                        <strong>
                            Hartritme-stoornis
                        </strong>
                    </p>
                    <p>
                        Terra heeft last van een hartritme-stoornis. Haar lichaamscellen krijgen op dat moment onvoldoende zuurstof. Door het gebrek aan zuurstof gaat de stofwisseling omlaag. Stofwisseling is een levenskenmerk.
                    </p>
                </div>
            </div>
            <table>
                <tr>
                    <td><p>hallo</p></td>
                    <td><p>zonder paragraaf</p></td>
                </tr>
            </table>
            <div class="qti-layout-col6">
                <div id="question">
                    <p>
                        <strong>
                            <span>
                                Noem een ander levenskenmerk.
                            </span>
                            &#xa0;&#xa0;
                        </strong>
                    </p>
                    <p/>
                </div>
                <div class="cito_genclass_bi_BB_073_03_1">
                    <div>
                        <qti-extended-text-interaction response-identifier="RESPONSE" id="I51355a70-0eec-467f-a428-e00fc7a881d2" class="qti-height-lines-6" expected-lines="5" expected-length="350"/>
                    </div>
                </div>
            </div>
        </div>  
    </div>
</qti-item-body>
`;
  const expectedOutput = xml`<?xml version="1.0" encoding="UTF-8"?>
    <qti-item-body class="defaultBody custom-qti-style cito-style" xml:lang="nl-NL">
      <div class="qti-layout-row">
          <div class="qti-layout-col6">
              <p>
                  <strong>
                  Hartritme-stoornis
                  </strong>
              </p>
              <p>
                  Terra heeft last van een hartritme-stoornis. Haar lichaamscellen krijgen op dat moment onvoldoende zuurstof. Door het gebrek aan zuurstof gaat de stofwisseling omlaag. Stofwisseling is een levenskenmerk.
              </p>
          </div>
          <table>
              <tr>
                  <td>hallo</td>
                  <td>zonder paragraaf</td>
              </tr>
          </table>
          <div class="qti-layout-col6">
              <p>
                  <strong>
                      <span>
                          Noem een ander levenskenmerk.
                      </span>
                  </strong>
              </p>
              <div>
                  <qti-extended-text-interaction response-identifier="RESPONSE" id="I51355a70-0eec-467f-a428-e00fc7a881d2" class="qti-height-lines-6" expected-lines="5" expected-length="350"/>
              </div>
          </div>
      </div>
  </qti-item-body>
`;
  const result = await qtiTransform(input).qbCleanup().xml();
  const areEqual = await areXmlEqual(result, expectedOutput);
  expect(areEqual).toEqual(true);
});

test('reset variables', async () => {
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
  <qti-assessment-item>
  <qti-item-body class="defaultBody" xml:lang="nl-NL">
   <div class="content">
    </div>
</qti-item-body>
 <qti-response-processing>
    <qti-set-outcome-value identifier="RAW_SCORE">
      <qti-base-value base-type="integer">0</qti-base-value>
    </qti-set-outcome-value>
    <qti-response-condition>
      <qti-response-if>
        <qti-member>
          <qti-base-value base-type="directedPair">y_A x_1</qti-base-value>
          <qti-variable identifier="RESPONSE" />
        </qti-member>
        <qti-set-outcome-value identifier="RAW_SCORE">
          <qti-sum>
            <qti-base-value base-type="integer">1</qti-base-value>
            <qti-variable identifier="RAW_SCORE" />
          </qti-sum>
        </qti-set-outcome-value>
      </qti-response-if>
    </qti-response-condition>
    <qti-response-condition>
      <qti-response-if>
        <qti-member>
          <qti-base-value base-type="directedPair">y_B x_2</qti-base-value>
          <qti-variable identifier="RESPONSE" />
        </qti-member>
        <qti-set-outcome-value identifier="RAW_SCORE">
          <qti-sum>
            <qti-base-value base-type="integer">1</qti-base-value>
            <qti-variable identifier="RAW_SCORE" />
          </qti-sum>
        </qti-set-outcome-value>
      </qti-response-if>
    </qti-response-condition>
    <qti-response-condition>
      <qti-response-if>
        <qti-member>
          <qti-base-value base-type="directedPair">y_C x_2</qti-base-value>
          <qti-variable identifier="RESPONSE" />
        </qti-member>
        <qti-set-outcome-value identifier="RAW_SCORE">
          <qti-sum>
            <qti-base-value base-type="integer">1</qti-base-value>
            <qti-variable identifier="RAW_SCORE" />
          </qti-sum>
        </qti-set-outcome-value>
      </qti-response-if>
    </qti-response-condition>
    <qti-lookup-outcome-value identifier="SCORE">
      <qti-variable identifier="RAW_SCORE" />
    </qti-lookup-outcome-value>
  </qti-response-processing>
   </qti-assessment-item>
`;
  const expectedOutput = xml`<qti-assessment-item>
  <qti-item-body class="defaultBody custom-qti-style cito-style" xml:lang="nl-NL">
  </qti-item-body>
  <qti-response-processing>
    <qti-set-outcome-value identifier="RAW_SCORE">
      <qti-base-value base-type="integer">0</qti-base-value>
    </qti-set-outcome-value>
    <qti-set-outcome-value identifier="RAW_SCORE">
      <qti-base-value base-type="integer">0</qti-base-value>
    </qti-set-outcome-value>
    <qti-response-condition>
      <qti-response-if>
        <qti-member>
          <qti-base-value base-type="directedPair">y_A x_1</qti-base-value>
          <qti-variable identifier="RESPONSE"/>
        </qti-member>
        <qti-set-outcome-value identifier="RAW_SCORE">
          <qti-sum>
            <qti-base-value base-type="integer">1</qti-base-value>
            <qti-variable identifier="RAW_SCORE"/>
          </qti-sum>
        </qti-set-outcome-value>
      </qti-response-if>
    </qti-response-condition>
    <qti-response-condition>
      <qti-response-if>
        <qti-member>
          <qti-base-value base-type="directedPair">y_B x_2</qti-base-value>
          <qti-variable identifier="RESPONSE"/>
        </qti-member>
        <qti-set-outcome-value identifier="RAW_SCORE">
          <qti-sum>
            <qti-base-value base-type="integer">1</qti-base-value>
            <qti-variable identifier="RAW_SCORE"/>
          </qti-sum>
        </qti-set-outcome-value>
      </qti-response-if>
    </qti-response-condition>
    <qti-response-condition>
      <qti-response-if>
        <qti-member>
          <qti-base-value base-type="directedPair">y_C x_2</qti-base-value>
          <qti-variable identifier="RESPONSE"/>
        </qti-member>
        <qti-set-outcome-value identifier="RAW_SCORE">
          <qti-sum>
            <qti-base-value base-type="integer">1</qti-base-value>
            <qti-variable identifier="RAW_SCORE"/>
          </qti-sum>
        </qti-set-outcome-value>
      </qti-response-if>
    </qti-response-condition>
    <qti-lookup-outcome-value identifier="SCORE">
      <qti-variable identifier="RAW_SCORE"/>
    </qti-lookup-outcome-value>
  </qti-response-processing>
</qti-assessment-item>
`;
  const result = await qtiTransform(input).qbCleanup().xml();
  console.log(result);
  const areEqual = await areXmlEqual(result, expectedOutput);
  expect(areEqual).toEqual(true);
});

test('does not wipe non-text content in layout columns (video)', async () => {
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
  <qti-item-body class="defaultBody" xml:lang="nl-NL">
    <div class="content">
      <div class="qti-layout-row">
        <div class="qti-layout-col6">
          <div id="leftbody">
            <p><span/></p>
            <div id="Iaf63a511-b761-4c53-bdef-b7115b8a123b">
              <qti-media-interaction response-identifier="VIDEORESPONSE" autostart="false" max-plays="0" id="I990c31b5-9070-4d01-a9d4-6fdf9a583aac">
                <video width="384" height="288" controls="">
                  <source src="../video/GSKB-cbt-24-11-02_T.webm" type="video/webm"/>
                </video>
              </qti-media-interaction>
            </div>
            <p><span/></p>
          </div>
        </div>
        <div class="qti-layout-col6">
          <div id="question">
            <p><strong><span>Onder welke naam staat de grensversperring bekend?</span></strong></p>
          </div>
        </div>
      </div>
    </div>
  </qti-item-body>
`;

  const expectedOutput = xml`<?xml version="1.0" encoding="UTF-8"?>
  <qti-item-body class="defaultBody custom-qti-style cito-style" xml:lang="nl-NL">
    <div class="qti-layout-row">
      <div class="qti-layout-col6">
        <div id="Iaf63a511-b761-4c53-bdef-b7115b8a123b">
          <qti-media-interaction response-identifier="VIDEORESPONSE" autostart="false" max-plays="0" id="I990c31b5-9070-4d01-a9d4-6fdf9a583aac">
            <video width="384" height="288" controls="">
              <source src="../video/GSKB-cbt-24-11-02_T.webm" type="video/webm"/>
            </video>
          </qti-media-interaction>
        </div>
      </div>
      <div class="qti-layout-col6">
        <p><strong><span>Onder welke naam staat de grensversperring bekend?</span></strong></p>
      </div>
    </div>
  </qti-item-body>
`;

  const result = await qtiTransform(input).qbCleanup().xml();
  const areEqual = await areXmlEqual(result, expectedOutput);
  expect(areEqual).toEqual(true);
});

test('does not remove images wrapped in spans', async () => {
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
  <qti-item-body class="defaultBody" xml:lang="nl-NL">
    <div class="content">
      <div class="qti-layout-row">
        <div class="qti-layout-col6">
          <div id="leftbody">
            <p><span>Een Britse poster uit de Eerste Wereldoorlog (1914-1918)</span></p>
            <p>
              <span>
                <img id="Id-IMG_ae59ea38-c799-40f7-a135-0e9e31f52115" src="../img/GSKB-cbt-24-09-02.jpg" width="334" height="500" alt=""/>
              </span>
            </p>
          </div>
        </div>
        <div class="qti-layout-col6">
          <div id="question">
            <p><strong><span>Bij welk gevolg past de oproep op de poster?</span></strong></p>
          </div>
        </div>
      </div>
    </div>
  </qti-item-body>
`;

  const expectedOutput = xml`<?xml version="1.0" encoding="UTF-8"?>
  <qti-item-body class="defaultBody custom-qti-style cito-style" xml:lang="nl-NL">
    <div class="qti-layout-row">
      <div class="qti-layout-col6">
        <p>Een Britse poster uit de Eerste Wereldoorlog (1914-1918)</p>
        <p>
          <img id="Id-IMG_ae59ea38-c799-40f7-a135-0e9e31f52115" src="../img/GSKB-cbt-24-09-02.jpg" width="334" height="500" alt=""/>
        </p>
      </div>
      <div class="qti-layout-col6">
        <p><strong><span>Bij welk gevolg past de oproep op de poster?</span></strong></p>
      </div>
    </div>
  </qti-item-body>
`;

  const result = await qtiTransform(input).qbCleanup().xml();
  const areEqual = await areXmlEqual(result, expectedOutput);
  expect(areEqual).toEqual(true);
});

test('unwraps direct container wrapper and adds style classes', async () => {
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
  <qti-item-body class="defaultBody" xml:lang="nl-NL">
    <div class="container">
      <p>Hallo</p>
    </div>
  </qti-item-body>
`;

  const expectedOutput = xml`<?xml version="1.0" encoding="UTF-8"?>
  <qti-item-body class="defaultBody custom-qti-style cito-style" xml:lang="nl-NL">
    <p>Hallo</p>
  </qti-item-body>
`;

  const result = await qtiTransform(input).qbCleanup().xml();
  const areEqual = await areXmlEqual(result, expectedOutput);
  expect(areEqual).toEqual(true);
});

test('cleanup QB qti - preserve text in nested spans', async () => {
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
  <qti-item-body class="defaultBody" xml:lang="nl-NL">
    <div class="content">
      <qti-simple-associable-choice identifier="y_B" match-max="1">
        <div>
          <p><span /> <span> <span>Door stuwdammen in een rivier aan te leggen krijgt een land een voorraad zoet water.</span></span></p>
        </div>
      </qti-simple-associable-choice>
      
      <!-- Additional test cases for span cleanup -->
      <div>
        <p><span></span>Some text after empty span</p>
        <p><span> </span>Text after whitespace-only span</p>
        <p><span><span></span>Nested empty spans</span> with text</p>
        <p><span><span>Nested span with text</span></span></p>
      </div>
    </div>
  </qti-item-body>`;

  const expectedOutput = xml`<?xml version="1.0" encoding="UTF-8"?>
    <qti-item-body class="defaultBody custom-qti-style cito-style" xml:lang="nl-NL">
      <qti-simple-associable-choice identifier="y_B" match-max="1">
        <div>
          <p>Door stuwdammen in een rivier aan te leggen krijgt een land een voorraad zoet water.</p>
        </div>
      </qti-simple-associable-choice>
      
      <div>
        <p>Some text after empty span</p>
        <p>Text after whitespace-only span</p>
        <p>Nested empty spans with text</p>
        <p>Nested span with text</p>
      </div>
    </qti-item-body>`;

  const result = await qtiTransform(input).qbCleanup().xml();
  console.log('Result:', result);
  const areEqual = await areXmlEqual(result, expectedOutput);
  expect(areEqual).toEqual(true);
});

test('cleanup QB qti - exact real world scenario', async () => {
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
  <qti-item-body class="defaultBody" xml:lang="nl-NL">
    <div class="content">
      <qti-simple-associable-choice identifier="y_B" match-max="1">
        <div>
          <p><span /> <span> <span>Door stuwdammen in een rivier aan te leggen krijgt een land een voorraad zoet water.</span></span></p>
        </div>
      </qti-simple-associable-choice>
    </div>
  </qti-item-body>`;

  const expectedOutput = xml`<?xml version="1.0" encoding="UTF-8"?>
    <qti-item-body class="defaultBody custom-qti-style cito-style" xml:lang="nl-NL">
      <qti-simple-associable-choice identifier="y_B" match-max="1">
        <div>
          <p>Door stuwdammen in een rivier aan te leggen krijgt een land een voorraad zoet water.</p>
        </div>
      </qti-simple-associable-choice>
    </qti-item-body>`;

  const result = await qtiTransform(input).qbCleanup().xml();
  console.log('Real world test result:', result);
  const areEqual = await areXmlEqual(result, expectedOutput);
  expect(areEqual).toEqual(true);
});

test('preserve QTI gap elements in spans', async () => {
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
  <qti-item-body xml:lang="nl-NL">
    <qti-gap-match-interaction id="gapMatchScoring" response-identifier="RESPONSE" max-associations="0" shuffle="false">
      <qti-gap-text identifier="A" match-max="1">
        <span>rupsen</span>
      </qti-gap-text>
      <qti-gap-text identifier="B" match-max="1">
        <span>koolplanten</span>
      </qti-gap-text>
      <qti-gap-text identifier="C" match-max="1">
        <span>volwassen sluipwesp</span>
      </qti-gap-text>
      <qti-gap-text identifier="D" match-max="1">
        <span>larven van sluipwesp</span>
      </qti-gap-text>
      <p><span><qti-gap identifier="G1" required="true"/></span>&#xa0;<m:math><m:mo>&#x2192;</m:mo></m:math>&#xa0;<span><qti-gap identifier="G2" required="true"/></span>&#xa0;<m:math><m:mo>&#x2192;</m:mo></m:math>&#xa0;<span><qti-gap identifier="G3" required="true"/></span></p>
    </qti-gap-match-interaction>
  </qti-item-body>`;

  const expectedOutput = xml`<?xml version="1.0" encoding="UTF-8"?>
  <qti-item-body xml:lang="nl-NL">
    <qti-gap-match-interaction id="gapMatchScoring" response-identifier="RESPONSE" max-associations="0" shuffle="false">
      <qti-gap-text identifier="A" match-max="1">
        <span>rupsen</span>
      </qti-gap-text>
      <qti-gap-text identifier="B" match-max="1">
        <span>koolplanten</span>
      </qti-gap-text>
      <qti-gap-text identifier="C" match-max="1">
        <span>volwassen sluipwesp</span>
      </qti-gap-text>
      <qti-gap-text identifier="D" match-max="1">
        <span>larven van sluipwesp</span>
      </qti-gap-text>
      <p><span><qti-gap identifier="G1" required="true"/></span> <m:math><m:mo>→</m:mo></m:math> <span><qti-gap identifier="G2" required="true"/></span> <m:math><m:mo>→</m:mo></m:math> <span><qti-gap identifier="G3" required="true"/></span></p>
    </qti-gap-match-interaction>
  </qti-item-body>`;

  const result = await qtiTransform(input).qbCleanup().xml();
  const areEqual = await areXmlEqual(result, expectedOutput);
  expect(areEqual).toEqual(true);
});

test('cleanup UserSRVet bold nesting', async () => {
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
  <qti-item-body xml:lang="nl-NL">
    <div class="content">
      <!-- Case 1: p.UserSRVet containing strong with spans -->
      <p class="UserSRVet">
        <strong>
          <span>Zelfstandig </span>
        </strong>
        <span>wonen</span>
      </p>
      
      <!-- Case 2: strong containing p.UserSRVet with spans -->
      <strong>
        <p class="UserSRVet">
          <span>Another </span>
          <span>example</span>
        </p>
      </strong>
      
      <!-- Case 3: More complex nesting -->
      <p class="UserSRVet">
        <strong>
          <span>Complex </span>
          <span>nested </span>
        </strong>
        <span>structure</span>
      </p>

      <!-- Case 4: Exact reported pattern -->
      <p class="UserSRVet"><strong>Zelfstandig</strong><span>wonen</span></p>
    </div>
  </qti-item-body>`;

  const expectedOutput = xml`<?xml version="1.0" encoding="UTF-8"?>
  <qti-item-body xml:lang="nl-NL" class="custom-qti-style cito-style">
      <!-- Case 1: p.UserSRVet containing strong with spans -->
      <p class="UserSRVet">
        <span>Zelfstandig </span>
        <span>wonen</span>
      </p>
      
      <!-- Case 2: strong containing p.UserSRVet with spans -->
      <strong>
        <p>
          <span>Another </span>
          <span>example</span>
        </p>
      </strong>
      
      <!-- Case 3: More complex nesting -->
      <p class="UserSRVet">
        <span>Complex </span>
        <span>nested </span>
        <span>structure</span>
      </p>

      <!-- Case 4: Exact reported pattern -->
      <p class="UserSRVet">Zelfstandig <span>wonen</span></p>
  </qti-item-body>`;

  const result = await qtiTransform(input).qbCleanup().xml();
  const areEqual = await areXmlEqual(result, expectedOutput);
  expect(areEqual).toEqual(true);
});
