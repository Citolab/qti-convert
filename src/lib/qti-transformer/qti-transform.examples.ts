import { qtiTransform } from './qti-transform';

const mathmlString = `<qti-itembody>
<math>
    <mfrac>
        <mi>a</mi>
        <mi>b</mi>
    </mfrac>
</math>
</qti-itembody>`;

const removeNamesSpacesString = `<root xmlns:foo="http://www.example.com/foo" xmlns:bar="http://www.example.com/bar">
<foo:element1>Content</foo:element1>
<bar:element2>Content</bar:element2>
</root>`;

const pciHooksString = `<qti-assessment-item>
<qti-item-body>
    <qti-portable-custom-interaction
        response-identifier="RESPONSE" 
        module="exampleLikertScale"
        custom-interaction-type-identifier="urn:fdc:example.com:pci:likertScale">
        <qti-interaction-markup></qti-interaction-markup>
    </qti-portable-custom-interaction>
</qti-item-body>
</qti-assessment-item>`;

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

const elementNameAttributesString = `<qti-assessment-item>
    <qti-item-body>
        <qti-select-point></qti-select-point>
    </qti-item-body>
</qti-assessment-item>`;

const operatorDefinitionString = `<qti-match>
<qti-custom-operator definition="type:parse-numeric-nl">
  <qti-variable identifier="RESPONSE" />
</qti-custom-operator>
<qti-correct identifier="RESPONSE" />
</qti-match>`;

const cDataToCommentString = `<qti-match><![CDATA[
  this should be transformed to commented CDATA
]]>
</qti-match>`;

// export const Default = {
//   render: args => {
const mathml = qtiTransform(mathmlString).mathml().xml();
const removeNamesSpaces = qtiTransform(removeNamesSpacesString).removeNamesSpaces().xml();
const pciHooks = qtiTransform(pciHooksString).pciHooks('http://qti-show/modules/').xml();
const assetsLocation = qtiTransform(assetsLocationString).assetsLocation('http://qti-show/static/').xml();
const customTypes = qtiTransform(customTypesString).customTypes().xml();
const suffix = qtiTransform(suffixString).suffix(['qti-select-point'], 'square').xml();
const elementNameAttributes = qtiTransform(elementNameAttributesString)
  .elementNameAttributes(['qti-select-point'])
  .xml();
const operatorDefinition = qtiTransform(operatorDefinitionString).customDefinition().xml();
const cDataToComment = qtiTransform(cDataToCommentString).cDataToComment().xml();

export const transforms = {
  mathml,
  removeNamesSpaces,
  pciHooks,
  assetsLocation,
  customTypes,
  suffix,
  elementNameAttributes,
  operatorDefinition,
  cDataToComment
};

export const transformStrings = {
  mathmlString,
  removeNamesSpacesString,
  pciHooksString,
  assetsLocationString,
  customTypesString,
  suffixString,
  elementNameAttributesString,
  operatorDefinitionString,
  cDataToCommentString
};
