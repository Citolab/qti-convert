import { expect, test } from 'vitest';

import { qtiTransform } from '../../qti-transform';
import * as cheerio from 'cheerio';

const xml = String.raw;

test('convert dep dialog to html popover', async () => {
  const id = 'WIN_d579fd6a-c46d-409a-a9f6-df7bbabcb8e3';

  const qti = xml`<qti-assessment-item xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
	xsi:schemaLocation="http://www.imsglobal.org/xsd/imsqtiasi_v3p0 https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqti_asiv3p0_v1p0.xsd
						http://www.duo.nl/schema/dep_extension ../dep_extension.xsd"
	title="32gbg6" identifier="ITM-32gbg6" time-dependent="false" label="32gbg6"
	xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"
	xmlns:dep="http://www.duo.nl/schema/dep_extension">
	<qti-item-body class="defaultBody" xml:lang="nl-NL">
		<div class="content">
			<div class="qti-layout-row">
				<div class="qti-layout-col6">
					<div id="leftbody">
						<p><span>» Klik op de kaart voor een vergroting.</span></p><p><span>Neerslag
			in het stroomgebied van de Rijn en de Maas</span></p><p
							class="cito_genclass_BB_2021_B1-017_1"><span /></p>
							<div
							class="dep-dialogTrigger"
							data-stimulus-idref="WIN_d579fd6a-c46d-409a-a9f6-df7bbabcb8e3">
							<img
								src="../img/AKbb201cbt-12ak.gif" alt="" width="344" height="331"
								id="Id-IMG-d3288d98-4e63-453f-b241-e4e5760d1768" /></div><p><span /></p>
								
								<div
							id="WIN_d579fd6a-c46d-409a-a9f6-df7bbabcb8e3"
							class="dep-dialog hide-dialog"
							data-dep-dialog-caption="Neerslag in het stroomgebied van de Rijn en de Maas"
							data-dep-dialog-width="548" data-dep-dialog-height="558"
							data-dep-dialog-resizemode="fixed" data-dep-dialog-modal="false"
							data-dep-dialog-open="true"><img src="../img/AKbb201cbt-12ag.gif"
								width="513" height="493" alt=""
								id="Id-IMG-a82f4c43-80a8-4020-86d2-9abb9eb4e719" /></div
								
								>
					</div>

				</div>
				<div
					class="qti-layout-col6">
					<div> </div>
				</div>
			</div>
		</div>
	</qti-item-body>
</qti-assessment-item>`;

  const result = await qtiTransform(qti).depConvert().xml();
  const $newQti = cheerio.load(result, { xmlMode: true, xml: true });

  const triggerParent = $newQti('.dep-dialogTrigger').parent();

  expect(triggerParent.is('button')).toEqual(true);
  expect(triggerParent.attr('popovertarget')).toEqual(id);

  const dialog = $newQti(`#${id}[popover]`);
  expect(dialog).length(1);
});
