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
    <qti-item-body xml:lang="nl-NL">
    <div class="container">
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
  <qti-item-body xml:lang="nl-NL">
    <div class="container">
    </div>
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
    <qti-item-body xml:lang="nl-NL">
      <div class="container">
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
    <qti-item-body xml:lang="nl-NL">
      <div class="container">
        <qti-simple-associable-choice identifier="y_B" match-max="1">
          <div>
            <p>Door stuwdammen in een rivier aan te leggen krijgt een land een voorraad zoet water.</p>
          </div>
        </qti-simple-associable-choice>
      </div>
    </qti-item-body>`;

  const result = await qtiTransform(input).qbCleanup().xml();
  console.log('Real world test result:', result);
  const areEqual = await areXmlEqual(result, expectedOutput);
  expect(areEqual).toEqual(true);
});
