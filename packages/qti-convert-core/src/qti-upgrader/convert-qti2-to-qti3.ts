import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { QTI3_NAMESPACE } from '../qti-downgrader/name-map';

// TypeScript port of qti30upgrader/qti2xTo30.xsl (ETS, Apache-2.0) plus the Citolab additions,
// without the XSLT/Saxon-JS dependency. Deliberate fixes compared to the XSLT:
// - stimulusBody, durationLT/GTE and a few QTI 2.x elements missing from the XSLT lists get their qti- name
// - testFeedback content is wrapped in qti-content-body like the other feedback elements
// - elements are matched by local name, so prefixed QTI 2 elements convert correctly
// - an <object> video keeps its converted children once (the XSLT copied them twice)
// - inline SVG stays in the SVG namespace

const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';
const XSI_NAMESPACE = 'http://www.w3.org/2001/XMLSchema-instance';
const MATHML_NAMESPACE = 'http://www.w3.org/1998/Math/MathML';
const SSML_NAMESPACE = 'http://www.w3.org/2001/10/synthesis';
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const MATHML_NAMESPACES = new Set([MATHML_NAMESPACE, 'http://www.w3.org/2010/Math/MathML']);
const SSML_NAMESPACES = new Set([SSML_NAMESPACE, 'http://www.w3.org/2010/10/synthesis']);

const QTI3_SCHEMA_LOCATION = `${QTI3_NAMESPACE} https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqti_asiv3p0_v1p0.xsd`;
const QTI3_RPTEMPLATES_URI = 'https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/';
const XML_MODEL_PI =
  '<?xml-model href="https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqti_asiv3p0_v1p0.xsd" type="application/xml" schematypens="http://purl.oclc.org/dsdl/schematron"?>';

/** QTI 2.x element names that become qti-<kebab-name> (the two lists of the XSLT plus the missing ones). */
const QTI2_ELEMENTS = new Set(
  (
    'and anyN areaMapEntry areaMapping assessmentStimulusRef associableHotspot associateInteraction baseValue ' +
    'calculator calculatorInfo calculatorType card cardEntry catalog catalogInfo choiceInteraction ' +
    'companionMaterialsInfo containerSize contains contentBody contextDeclaration contextVariable correct ' +
    'correctResponse customInteraction customOperator default defaultValue delete description digitalMaterial ' +
    'divide drawingInteraction durationGte durationLt endAttemptInteraction equal equalRounded exitResponse ' +
    'exitTemplate extendedTextInteraction feedbackInline fieldValue fileHref gap gapImg gapMatchInteraction ' +
    'gapText gcd graphicAssociateInteraction graphicGapMatchInteraction graphicOrderInteraction gt gte ' +
    'hotspotChoice hotspotInteraction hottext hottextInteraction htmlContent incrementSi incrementUs index ' +
    'inlineChoice inlineChoiceInteraction inside integerDivide integerModulus integerToFloat interactionMarkup ' +
    'interactionModule interactionModules interpolationTable interpolationTableEntry isNull itemBody label lcm ' +
    'lookupOutcomeValue lt lte majorIncrement mapEntry mapResponse mapResponsePoint mapping match ' +
    'matchInteraction matchTable matchTableEntry mathConstant mathOperator max mediaInteraction member min ' +
    'minimumLength minorIncrement multiple not null numberCorrect numberIncorrect numberPresented ' +
    'numberResponded numberSelected or orderInteraction ordered outcomeDeclaration outcomeMaximum ' +
    'outcomeMinimum patternMatch physicalMaterial portableCustomInteraction positionObjectInteraction ' +
    'positionObjectStage power printedVariable product prompt protractor random randomFloat randomInteger ' +
    'repeat resourceIcon responseCondition responseDeclaration responseElse responseElseIf responseIf ' +
    'responseProcessing responseProcessingFragment round roundTo rule ruleSystemSi ruleSystemUs ' +
    'selectPointInteraction setCorrectResponse setDefaultValue setOutcomeValue setTemplateValue ' +
    'simpleAssociableChoice simpleChoice simpleMatchSet sliderInteraction statsOperator stringMatch stylesheet ' +
    'substring subtract sum templateBlock templateCondition templateConstraint templateDeclaration templateElse ' +
    'templateElseIf templateIf templateInline templateProcessing templateVariable textEntryInteraction truncate ' +
    'uploadInteraction value variable ' +
    // assessment test elements
    'assessmentTest testPart assessmentSection assessmentSectionRef assessmentItemRef weight outcomeProcessing ' +
    'outcomeCondition outcomeIf outcomeElse testVariables timeLimits itemSessionControl selection ordering ' +
    'adaptiveSelection adaptiveEngineRef adaptiveSettingsRef metadataRef branchRule preCondition ' +
    // not in the XSLT lists
    'stimulusBody outcomeElseIf exitTest testFeedback templateDefault variableMapping infoControl'
  ).split(' ')
);

const IRREGULAR_ELEMENT_NAMES: Record<string, string> = {
  durationLT: 'qti-duration-lt',
  durationGTE: 'qti-duration-gte',
  incrementSI: 'qti-increment-si',
  incrementUS: 'qti-increment-us',
  ruleSystemSI: 'qti-rule-system-si',
  ruleSystemUS: 'qti-rule-system-us'
};

const ROOT_ELEMENTS = new Set(['assessmentItem', 'assessmentStimulus', 'assessmentTest']);
const CONTENT_BODY_ELEMENTS = new Set(['feedbackBlock', 'modalFeedback', 'rubricBlock', 'templateBlock', 'testFeedback']);

export const kabobize = (name: string) => name.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
const qtiKabobify = (localName: string) => IRREGULAR_ELEMENT_NAMES[localName] ?? `qti-${kabobize(localName)}`;

const isElement = (node: AnyNode): node is Element => node.type === 'tag';
const splitName = (name: string) => {
  const index = name.indexOf(':');
  return index === -1 ? { prefix: '', local: name } : { prefix: name.slice(0, index), local: name.slice(index + 1) };
};
const escapeAttribute = (value: string) => value.replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Resolves a namespace prefix ('' for the default namespace) from the input document's declarations. */
const resolveNamespace = (el: Element, prefix: string): string => {
  if (prefix === 'xml') return XML_NAMESPACE;
  const attr = prefix ? `xmlns:${prefix}` : 'xmlns';
  for (let node: Element | null = el; node && isElement(node); node = node.parent as Element | null) {
    if (node.attribs && attr in node.attribs) return node.attribs[attr];
  }
  return '';
};

interface Scope {
  defaultNamespace: string;
  prefixes: Map<string, string>;
}

type Attributes = [string, string][];

const kabobAttributes = (el: Element, exclude: (name: string) => boolean = () => false): Attributes =>
  Object.entries(el.attribs)
    .filter(([name]) => !name.startsWith('xmlns') && !exclude(name))
    .map(([name, value]) => [/^(aria|data)-/.test(name) ? name : kabobize(name), value]);

const copyAttributes = (el: Element): Attributes =>
  Object.entries(el.attribs).filter(([name]) => !name.startsWith('xmlns'));

class Upgrader {
  constructor(private $: cheerio.CheerioAPI) {}

  /** Serializes an element; declares namespaces for the element name and prefixed attributes when needed. */
  private element(
    source: Element,
    name: string,
    namespace: string,
    attributes: Attributes,
    scope: Scope,
    content: (scope: Scope) => string
  ) {
    const declarations: Attributes = [];
    const innerScope: Scope = { defaultNamespace: scope.defaultNamespace, prefixes: new Map(scope.prefixes) };
    if (namespace !== scope.defaultNamespace) {
      declarations.push(['xmlns', namespace]);
      innerScope.defaultNamespace = namespace;
    }
    for (const [attrName] of attributes) {
      const { prefix } = splitName(attrName);
      if (!prefix || prefix === 'xml') continue;
      const uri = prefix === 'xsi' ? XSI_NAMESPACE : resolveNamespace(source, prefix);
      if (uri && innerScope.prefixes.get(prefix) !== uri) {
        declarations.push([`xmlns:${prefix}`, uri]);
        innerScope.prefixes.set(prefix, uri);
      }
    }
    const attrs = [...declarations, ...attributes].map(([n, v]) => ` ${n}="${escapeAttribute(v)}"`).join('');
    const inner = content(innerScope);
    return inner ? `<${name}${attrs}>${inner}</${name}>` : `<${name}${attrs}/>`;
  }

  private children(nodes: AnyNode[], scope: Scope) {
    return nodes.map(node => this.node(node, scope)).join('');
  }

  node(node: AnyNode, scope: Scope): string {
    switch (node.type) {
      case 'text':
        return node.data;
      case 'cdata':
        return `<![CDATA[${node.children.map(child => (child.type === 'text' ? child.data : '')).join('')}]]>`;
      case 'comment':
        return `<!--${node.data}-->`;
      case 'directive': {
        // processing instructions; the XML declaration and existing schematron associations are dropped
        const data = node.data;
        if (/^\?xml\s/i.test(data) || (/^\?xml-model/.test(data) && data.includes('dsdl/schematron'))) return '';
        return `<${data}>`;
      }
      case 'tag':
        return this.tag(node, scope);
      default:
        return '';
    }
  }

  private tag(el: Element, scope: Scope): string {
    const $ = this.$;
    const { prefix, local } = splitName(el.name);
    const namespace = resolveNamespace(el, prefix);

    if (local === 'apipAccessibility') return '';

    if (MATHML_NAMESPACES.has(namespace)) {
      return this.element(el, local, MATHML_NAMESPACE, copyAttributes(el), scope, s => this.children(el.children, s));
    }
    if (SSML_NAMESPACES.has(namespace)) {
      return this.element(el, local, SSML_NAMESPACE, copyAttributes(el), scope, s => this.children(el.children, s));
    }
    if (namespace === SVG_NAMESPACE) {
      return this.element(el, local, SVG_NAMESPACE, copyAttributes(el), scope, s => this.children(el.children, s));
    }

    const type = el.attribs.type || '';
    if (local === 'object' && type.startsWith('image')) {
      const others = copyAttributes(el).filter(([name]) => name !== 'data' && name !== 'type');
      return this.element(el, 'img', QTI3_NAMESPACE, [['src', el.attribs.data ?? ''], ['alt', $(el).text()], ...others], scope, () => '');
    }
    if (local === 'object' && type.startsWith('video')) {
      const others = copyAttributes(el).filter(([name]) => name !== 'data' && name !== 'type');
      return this.element(el, 'video', QTI3_NAMESPACE, [['src', el.attribs.data ?? ''], ...others], scope, s =>
        this.children(el.children, s) + this.element(el, 'source', QTI3_NAMESPACE, [['type', type], ['src', el.attribs.data ?? '']], s, () => '')
      );
    }

    if (ROOT_ELEMENTS.has(local)) {
      const attributes: Attributes = [
        ['xsi:schemaLocation', QTI3_SCHEMA_LOCATION],
        ...kabobAttributes(el, name => name === 'xsi:schemaLocation')
      ];
      return this.element(el, qtiKabobify(local), QTI3_NAMESPACE, attributes, scope, s => this.children(el.children, s));
    }

    if (CONTENT_BODY_ELEMENTS.has(local)) {
      const isStylesheet = (node: AnyNode) => isElement(node) && splitName(node.name).local === 'stylesheet';
      return this.element(el, qtiKabobify(local), QTI3_NAMESPACE, kabobAttributes(el), scope, s => {
        const stylesheets = this.children(el.children.filter(isStylesheet), s);
        const body = this.children(el.children.filter(node => !isStylesheet(node)), s);
        return stylesheets + this.element(el, 'qti-content-body', QTI3_NAMESPACE, [], s, () => body);
      });
    }

    let attributes = kabobAttributes(el);
    if (local === 'responseProcessing') {
      attributes = attributes.map(([name, value]) =>
        name === 'template' ? [name, `${value.replace(/^.*\//, QTI3_RPTEMPLATES_URI)}.xml`] : [name, value]
      );
    }
    const name = QTI2_ELEMENTS.has(local) || IRREGULAR_ELEMENT_NAMES[local] ? qtiKabobify(local) : local;
    return this.element(el, name, QTI3_NAMESPACE, attributes, scope, s => this.children(el.children, s));
  }
}

/**
 * Converts QTI 2.x (item, test or stimulus) XML to QTI 3.0. Synchronous and environment-agnostic.
 */
export const upgradeQti2toQti3 = (qti2: string): string => {
  const $ = cheerio.load(qti2.replace(/^[\s\S]*?(?=<)/, ''), { xml: { xmlMode: true, decodeEntities: false } });
  const upgrader = new Upgrader($);
  const scope: Scope = { defaultNamespace: '', prefixes: new Map() };
  const content = $.root()
    .contents()
    .toArray()
    .filter(node => node.type !== 'text')
    .map(node => upgrader.node(node, scope))
    .filter(Boolean)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n${XML_MODEL_PI}\n${content}`;
};
