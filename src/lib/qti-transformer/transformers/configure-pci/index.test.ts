import { expect, test } from 'vitest';
import { qtiTransform } from '../../qti-transform';
import { areXmlEqual } from '../utils-node-only';
import { ModuleResolutionConfig } from '.';

const xml = String.raw;

test('PCI - merge module resolution', async () => {
  const qti = xml`<qti-portable-custom-interaction
      custom-interaction-type-identifier="GraphAmpIO"
      data-height="360"
      data-prompt="Use the drawing tool(s) to form the correct answer on the provided graph."
      data-show-axes="true"
      data-width="360"
      data-x="-10,10"
      data-x-step="1"
      data-y="-10,10"
      data-y-step="1"
      module="graphInteraction"
      response-identifier="RESPONSE"
      data-base-url="/assets/qti-portable-custom-interaction/"
    >
      <qti-interaction-markup>
        <div class="qti-padding-2">
          <div class="graphInteraction">
            <div class="graph-interaction">
              <div class="graph-interaction__prompt"></div>
              <div class="graph-interaction__canvas"></div>
            </div>
          </div>
        </div>
      </qti-interaction-markup>
    </qti-portable-custom-interaction>`;

  const xpect = xml`<qti-portable-custom-interaction
      custom-interaction-type-identifier="GraphAmpIO"
      data-height="360"
      data-prompt="Use the drawing tool(s) to form the correct answer on the provided graph."
      data-show-axes="true"
      data-width="360"
      data-x="-10,10"
      data-x-step="1"
      data-y="-10,10"
      data-y-step="1"
      module="graphInteraction"
      response-identifier="RESPONSE"
      data-base-url="/assets/qti-portable-custom-interaction/"
    >
      <qti-interaction-markup>
        <div class="qti-padding-2">
          <div class="graphInteraction">
            <div class="graph-interaction">
              <div class="graph-interaction__prompt"></div>
              <div class="graph-interaction__canvas"></div>
            </div>
          </div>
        </div>
      </qti-interaction-markup>
      <qti-interaction-modules>
          <qti-interaction-module
            id="graphInteraction"
            primary-path="modules/graphInteraction"
          ></qti-interaction-module>
          <qti-interaction-module
            id="tap"
            primary-path="tap"
          >
          </qti-interaction-module>
          <qti-interaction-module
            id="d3"
            primary-path="modules/d3.v5.min"
          > 
          </qti-interaction-module>
        </qti-interaction-modules>
        </qti-portable-custom-interaction>`;

  const getConfig = (url: string) => {
    if (url.includes('fallback')) {
      return Promise.resolve(null);
    } else {
      return Promise.resolve({
        waitSeconds: 60,
        paths: {
          graphInteraction: 'modules/graphInteraction',
          tap: 'tap',
          d3: 'modules/d3.v5.min'
        }
      } as ModuleResolutionConfig);
    }
  };

  const result = await qtiTransform(qti).configurePciAsync(getConfig);
  const resultQti = result.xml();
  const areEqual = await areXmlEqual(resultQti, xpect);
  expect(areEqual).toEqual(true);
});

test('PCI - make custom-interaction-type-identifier unique', async () => {
  const qti = xml`<div><qti-portable-custom-interaction
        custom-interaction-type-identifier="urn:fdc:hmhco.com:pci:shading"
        data-active="0"
        module="shading"
        data-controls="none"
        data-dimension1_initial="3"
        data-dimension2_initial="2"
        data-element_diameter="60"
        data-render="grid"
        data-selected="0.0,1.0"
        data-selected_color="red"
        data-unselected_color="white"
        data-value="numShaded"
        response-identifier="EXAMPLE"
        data-base-url="/assets/qti-portable-custom-interaction/"
      >
        <qti-interaction-modules>
          <qti-interaction-module
            id="jquery"
            primary-path="https://code.jquery.com/jquery-2.2.2.min.js"
          ></qti-interaction-module>
          <qti-interaction-module
            fallback-path="modules/shading.js"
            id="shading"
            primary-path="modules/shadingXX.js"
          ></qti-interaction-module>
        </qti-interaction-modules>
        <qti-interaction-markup></qti-interaction-markup>
      </qti-portable-custom-interaction>
      <p>
        By the second week she has already saved the exact amount she planned on spending on the present ($30) and is
        trying to work out if she will be able to afford a more expensive present costing $45.
      </p>
      <p>
        To help her do this use the buttons below to create a chart representing $45 assuming that each square
        represents $5 and then click to shade the fraction of the chart representing the amount saved in two weeks.
      </p>
      <qti-portable-custom-interaction
        custom-interaction-type-identifier="urn:fdc:hmhco.com:pci:shading"
        data-controls="full"
        data-dimension1_initial="2"
        data-dimension2_initial="2"
        data-element_diameter="60"
        data-render="grid"
        data-selected_color="red"
        data-unselected_color="white"
        data-value="numShaded"
        module="shading"
        response-identifier="RESPONSE"
        data-base-url="/assets/qti-portable-custom-interaction/"
      >
        <qti-interaction-modules>
          <qti-interaction-module
            id="jquery"
            primary-path="https://code.jquery.com/jquery-2.2.2.min.js"
          ></qti-interaction-module>
          <qti-interaction-module
            fallback-path="modules/shading.js"
            id="shading"
            primary-path="modules/shadingYY.js"
          ></qti-interaction-module>
        </qti-interaction-modules>
        <qti-interaction-markup></qti-interaction-markup>
      </qti-portable-custom-interaction>
    </div></div>`;

  const xpect = xml`<div><qti-portable-custom-interaction
        custom-interaction-type-identifier="urn:fdc:hmhco.com:pci:shading"
        data-active="0"
        module="shading"
        data-controls="none"
        data-dimension1_initial="3"
        data-dimension2_initial="2"
        data-element_diameter="60"
        data-render="grid"
        data-selected="0.0,1.0"
        data-selected_color="red"
        data-unselected_color="white"
        data-value="numShaded"
        response-identifier="EXAMPLE"
        data-base-url="/assets/qti-portable-custom-interaction/"
      >
        <qti-interaction-modules>
          <qti-interaction-module
            id="jquery"
            primary-path="https://code.jquery.com/jquery-2.2.2.min.js"
          ></qti-interaction-module>
          <qti-interaction-module
            fallback-path="modules/shading.js"
            id="shading"
            primary-path="modules/shadingXX.js"
          ></qti-interaction-module>
        </qti-interaction-modules>
        <qti-interaction-markup></qti-interaction-markup>
      </qti-portable-custom-interaction>
      <p>
        By the second week she has already saved the exact amount she planned on spending on the present ($30) and is
        trying to work out if she will be able to afford a more expensive present costing $45.
      </p>
      <p>
        To help her do this use the buttons below to create a chart representing $45 assuming that each square
        represents $5 and then click to shade the fraction of the chart representing the amount saved in two weeks.
      </p>
      <qti-portable-custom-interaction
        custom-interaction-type-identifier="urn:fdc:hmhco.com:pci:shading1"
        data-controls="full"
        data-dimension1_initial="2"
        data-dimension2_initial="2"
        data-element_diameter="60"
        data-render="grid"
        data-selected_color="red"
        data-unselected_color="white"
        data-value="numShaded"
        module="shading"
        response-identifier="RESPONSE"
        data-base-url="/assets/qti-portable-custom-interaction/"
      >
        <qti-interaction-modules>
          <qti-interaction-module
            id="jquery"
            primary-path="https://code.jquery.com/jquery-2.2.2.min.js"
          ></qti-interaction-module>
          <qti-interaction-module
            fallback-path="modules/shading.js"
            id="shading"
            primary-path="modules/shadingYY.js"
          ></qti-interaction-module>
        </qti-interaction-modules>
        <qti-interaction-markup></qti-interaction-markup>
      </qti-portable-custom-interaction>
    </div></div>`;

  const getConfig = () => {
    return Promise.resolve(null);
  };

  const result = await qtiTransform(qti).configurePciAsync(getConfig);
  const resultQti = result.xml();
  const areEqual = await areXmlEqual(resultQti, xpect);
  expect(areEqual).toEqual(true);
});
