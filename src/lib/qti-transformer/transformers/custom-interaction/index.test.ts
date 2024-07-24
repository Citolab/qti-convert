import { expect, test } from 'vitest';
import { qtiTransform } from '../../qti-transform';
import { areXmlEqual } from '../utils-node-only';

const xml = String.raw;

test('convert qti-interaction to something that the QTI components can understand', async () => {
  const qti = xml`<qti-custom-interaction
        response-identifier="RESPONSE"
        id="Ie855768e-179b-4226-a30e-6ead190c14b7"
        data-dep-min-values="0"
      >
        <object
          type="application/javascript"
          height="370"
          width="467"
          data="../ref/6047-BiKB-bmi_467x370_29/json/manifest.json"
        >
          <param name="responseLength" value="1" valuetype="DATA" />
        </object>
      </qti-custom-interaction>`;

  const result = await qtiTransform(qti).customInteraction('/', 'items/').xml();
  const expectedOutput = `<qti-custom-interaction response-identifier="RESPONSE" id="Ie855768e-179b-4226-a30e-6ead190c14b7" data-dep-min-values="0" data-base-ref="/" data-base-item="/items/" data="../ref/6047-BiKB-bmi_467x370_29/json/manifest.json" width="467" height="370">
</qti-custom-interaction>`;
  const areEqual = await areXmlEqual(result, expectedOutput);
  expect(areEqual).toEqual(true);
});
