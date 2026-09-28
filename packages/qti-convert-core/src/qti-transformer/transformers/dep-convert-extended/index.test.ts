import { expect, test } from 'vitest';

import { qtiTransform } from '../../qti-transform';
import * as cheerio from 'cheerio';

const xml = String.raw;

const item = (dialogAttributes: string) => xml`<qti-assessment-item
	xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"
	identifier="ITM-enlarge" title="enlarge" time-dependent="false">
	<qti-item-body>
		<p>Klik op de kaart voor een vergroting.</p>
		<div class="dep-dialogTrigger" data-stimulus-idref="WIN_kaart1">
			<img src="../img/kaart1-klein.jpg" width="150" alt="Kaart 1 (klein)" />
		</div>
		<div id="WIN_kaart1" class="dep-dialog hide-dialog" ${dialogAttributes}>
			<img src="../img/kaart1-groot.jpg" width="425" alt="Kaart 1 (groot)" />
		</div>
	</qti-item-body>
</qti-assessment-item>`;

test('convert dep dialog to dep-popup', async () => {
  const qti = item(
    'data-dep-dialog-caption="Kaart 1" data-dep-dialog-width="460" data-dep-dialog-height="308" data-dep-dialog-resizemode="fixed" data-dep-dialog-modal="false"'
  );

  const result = qtiTransform(qti).depConvertExtended().xml();
  const $ = cheerio.load(result, { xmlMode: true, xml: true });

  const popup = $('qti-item-body > dep-popup');
  expect(popup).length(1);
  expect(popup.attr('caption')).toEqual('Kaart 1');
  expect(popup.attr('width')).toEqual('460');
  expect(popup.attr('height')).toEqual('308');
  expect(popup.attr('resizemode')).toEqual('fixed');
  expect(popup.attr('modal')).toEqual('false');

  // thumbnail stays in the default slot, the enlarged image moves to the popup slot
  expect(popup.find('> .dep-dialogTrigger > img').attr('src')).toEqual('../img/kaart1-klein.jpg');
  expect(popup.find('> [slot="popup"] > img').attr('src')).toEqual('../img/kaart1-groot.jpg');

  // the original dialog is gone
  expect($('#WIN_kaart1')).length(0);
  expect($('.dep-dialog')).length(0);
});

test('dep-popup trigger has no data-stimulus-idref, so qti-components does not empty it', async () => {
  const result = qtiTransform(item('data-dep-dialog-caption="Kaart 1"')).depConvertExtended().xml();
  const $ = cheerio.load(result, { xmlMode: true, xml: true });

  expect($('[data-stimulus-idref]')).length(0);
  expect($('dep-popup .dep-dialogTrigger img')).length(1);
});

test('dep-popup only gets the dialog settings that are present', async () => {
  const result = qtiTransform(item('data-dep-dialog-caption="Kaart 1" data-dep-dialog-resizemode="auto"'))
    .depConvertExtended()
    .xml();
  const $ = cheerio.load(result, { xmlMode: true, xml: true });

  const popup = $('dep-popup');
  expect(popup.attr('caption')).toEqual('Kaart 1');
  expect(popup.attr('resizemode')).toEqual('auto');
  // an empty modal/width/height would switch dep-popup to modal and size 0
  expect(popup.attr('modal')).toBeUndefined();
  expect(popup.attr('width')).toBeUndefined();
  expect(popup.attr('height')).toBeUndefined();
});

test('trigger without a matching dialog is left untouched', async () => {
  const qti = xml`<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="ITM-x" title="x" time-dependent="false">
	<qti-item-body>
		<div class="dep-dialogTrigger" data-stimulus-idref="WIN_missing"><img src="a.jpg" alt="" /></div>
	</qti-item-body>
</qti-assessment-item>`;

  const result = qtiTransform(qti).depConvertExtended().xml();
  const $ = cheerio.load(result, { xmlMode: true, xml: true });

  expect($('dep-popup')).length(0);
  expect($('.dep-dialogTrigger').attr('data-stimulus-idref')).toEqual('WIN_missing');
});
