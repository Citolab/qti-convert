import { qtiTransform } from './qti-transform';

const mathmlString = `<qti-itembody>
<math>
    <mfrac>
        <mi>a</mi>
        <mi>b</mi>
    </mfrac>
</math>
</qti-itembody>`;

const assetsLocationString = `<qti-assessment-item>
<qti-item-body>
    <img src="../img/picture.png" />
</qti-item-body>
</qti-assessment-item>`;

const customTypesString = `<qti-assessment-item>
<qti-item-body>
    <qti-choice-interaction class="type:effect"></qti-choice-interaction>
</qti-item-body>
</qti-assessment-item>`;

const suffixString = `<qti-assessment-item>
<qti-item-body>
    <qti-select-point></qti-select-point>
</qti-item-body>
</qti-assessment-item>`;

const mathml = qtiTransform(mathmlString).mathml().xml();
const assetsLocation = qtiTransform(assetsLocationString)
  .changeAssetLocation(url => new URL(url, 'http://qti-show/static/item/').href)
  .xml();
const customTypes = qtiTransform(customTypesString).customTypes().xml();
const suffix = qtiTransform(suffixString).suffix(['qti-select-point'], 'square').xml();

export const transforms = {
  mathml,
  assetsLocation,
  customTypes,
  suffix
};

export const transformStrings = {
  mathmlString,
  assetsLocationString,
  customTypesString,
  suffixString
};
