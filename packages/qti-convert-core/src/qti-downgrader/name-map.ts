// QTI 2.1 specifics for the downgrader; the element name table itself lives in ../qti-names.
import { camelize, QTI3_NAMESPACE, qti3ElementNameToQti2 } from '../qti-names/qti-names';

export { QTI3_NAMESPACE };

export const QTI21_NAMESPACE = 'http://www.imsglobal.org/xsd/imsqti_v2p1';
export const QTI21_SCHEMA_LOCATION = `${QTI21_NAMESPACE} http://www.imsglobal.org/xsd/qti/qtiv2p1/imsqti_v2p1p2.xsd`;
export const QTI21_RPTEMPLATES_URI = 'http://www.imsglobal.org/question/qti_v2p1/rptemplates/';

export const IMSCP21_NAMESPACE = 'http://www.imsglobal.org/xsd/imscp_v1p1';
export const QTI21_METADATA_NAMESPACE = 'http://www.imsglobal.org/xsd/imsqti_metadata_v2p1';
export const IMSCP21_SCHEMA_LOCATION = [
  `${IMSCP21_NAMESPACE} http://www.imsglobal.org/xsd/qti/qtiv2p1/qtiv2p1_imscpv1p2_v1p0.xsd`,
  `${QTI21_METADATA_NAMESPACE} http://www.imsglobal.org/xsd/qti/qtiv2p1/imsqti_metadata_v2p1p1.xsd`,
  'http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd'
].join(' ');

/** QTI 3 elements that only exist in QTI 3.0 (or 2.2) and are removed including their content. */
export const QTI3_ONLY_REMOVE = new Set([
  'qti-catalog-info',
  'qti-companion-materials-info',
  'qti-context-declaration',
  'qti-assessment-stimulus-ref' // inlined when resolvable, see inlineSharedStimuli
]);

/** Elements that are only valid in QTI 2.2+ and are renamed to generic XHTML with a warning. */
export const HTML5_TO_HTML4: Record<string, string> = {
  article: 'div',
  aside: 'div',
  bdi: 'span',
  figcaption: 'div',
  figure: 'div',
  footer: 'div',
  header: 'div',
  mark: 'span',
  nav: 'div',
  section: 'div'
};

/** Attributes added in QTI 3.0 (or 2.2) that have no QTI 2.1 equivalent, per QTI 3 element name. */
export const QTI3_ONLY_ATTRIBUTES: Record<string, string[]> = {
  'qti-rubric-block': ['use'],
  'qti-outcome-declaration': ['external-scored', 'variable-identifier-ref'],
  'qti-choice-interaction': ['orientation']
};

/** Interactions that require an <object> (not an <img>) as background in QTI 2.1. */
export const GRAPHIC_INTERACTIONS = new Set([
  'qti-hotspot-interaction',
  'qti-select-point-interaction',
  'qti-graphic-order-interaction',
  'qti-graphic-associate-interaction',
  'qti-graphic-gap-match-interaction',
  'qti-position-object-stage',
  'qti-gap-img'
]);

/** qti-choice-interaction -> choiceInteraction. Returns null for non-QTI (e.g. XHTML) elements. */
export const qti3ElementNameToQti21 = qti3ElementNameToQti2;

/** response-identifier -> responseIdentifier; xml:lang, xmlns and friends are left untouched. */
export const qti3AttributeNameToQti21 = (name: string): string => (name.includes(':') ? name : camelize(name));

/** https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct.xml -> 2.1 template URI. */
export const qti3RpTemplateToQti21 = (template: string): string => {
  const match = template.match(/rptemplates\/([^/]+?)(\.xml)?$/);
  return match ? `${QTI21_RPTEMPLATES_URI}${match[1]}` : template;
};

/** imsqti_item_xmlv3p0 -> imsqti_item_xmlv2p1 */
export const qti3ResourceTypeToQti21 = (type: string): string => type.replace(/xmlv3p0$/, 'xmlv2p1');
