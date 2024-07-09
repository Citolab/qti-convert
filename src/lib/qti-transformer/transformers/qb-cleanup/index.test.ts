import { expect, test } from 'vitest';

import { qtiTransform } from '../../qti-transform';
import { areXmlEqual } from '../utils-node-only';
import { qbCleanup } from '.';

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
  const result = await qtiTransform(input).fnCh(qbCleanup).xml();
  const areEqual = await areXmlEqual(result, expectedOutput);
  expect(areEqual).toEqual(true);
});
