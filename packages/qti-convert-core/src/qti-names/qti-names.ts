// The single element name table shared by the QTI 2 -> 3 upgrader and the QTI 3 -> 2.1 downgrader.
// QTI 3 names are the QTI 2 names "kabobized" with a qti- prefix (choiceInteraction -> qti-choice-interaction),
// except for a few irregular ones.

export const QTI3_NAMESPACE = 'http://www.imsglobal.org/xsd/imsqtiasi_v3p0';

/** QTI 2.x elements (item, test and stimulus) that have a qti-* counterpart in QTI 3. */
export const QTI2_ELEMENT_NAMES: ReadonlySet<string> = new Set(
  (
    'and anyN areaMapEntry areaMapping assessmentStimulusRef associableHotspot associateInteraction baseValue ' +
    'calculator calculatorInfo calculatorType card cardEntry catalog catalogInfo choiceInteraction ' +
    'companionMaterialsInfo containerSize contains contentBody contextDeclaration contextVariable correct ' +
    'correctResponse customInteraction customOperator default defaultValue delete description digitalMaterial ' +
    'divide drawingInteraction endAttemptInteraction equal equalRounded exitResponse ' +
    'exitTemplate extendedTextInteraction feedbackInline fieldValue fileHref gap gapImg gapMatchInteraction ' +
    'gapText gcd graphicAssociateInteraction graphicGapMatchInteraction graphicOrderInteraction gt gte ' +
    'hotspotChoice hotspotInteraction hottext hottextInteraction htmlContent index ' +
    'inlineChoice inlineChoiceInteraction inside integerDivide integerModulus integerToFloat interactionMarkup ' +
    'interactionModule interactionModules interpolationTable interpolationTableEntry isNull itemBody label lcm ' +
    'lookupOutcomeValue lt lte majorIncrement mapEntry mapResponse mapResponsePoint mapping match ' +
    'matchInteraction matchTable matchTableEntry mathConstant mathOperator max mediaInteraction member min ' +
    'minimumLength minorIncrement multiple not null numberCorrect numberIncorrect numberPresented ' +
    'numberResponded numberSelected or orderInteraction ordered outcomeDeclaration outcomeMaximum ' +
    'outcomeMinimum patternMatch physicalMaterial portableCustomInteraction positionObjectInteraction ' +
    'positionObjectStage power printedVariable product prompt protractor random randomFloat randomInteger ' +
    'repeat resourceIcon responseCondition responseDeclaration responseElse responseElseIf responseIf ' +
    'responseProcessing responseProcessingFragment round roundTo rule ' +
    'selectPointInteraction setCorrectResponse setDefaultValue setOutcomeValue setTemplateValue ' +
    'simpleAssociableChoice simpleChoice simpleMatchSet sliderInteraction statsOperator stringMatch stylesheet ' +
    'substring subtract sum templateBlock templateCondition templateConstraint templateDeclaration templateElse ' +
    'templateElseIf templateIf templateInline templateProcessing templateVariable textEntryInteraction truncate ' +
    'uploadInteraction value variable ' +
    // assessment test elements
    'assessmentTest testPart assessmentSection assessmentSectionRef assessmentItemRef weight outcomeProcessing ' +
    'outcomeCondition outcomeIf outcomeElse testVariables timeLimits itemSessionControl selection ordering ' +
    'adaptiveSelection adaptiveEngineRef adaptiveSettingsRef metadataRef branchRule preCondition ' +
    // roots and feedback containers
    'assessmentItem assessmentStimulus feedbackBlock modalFeedback rubricBlock ' +
    // not in the qti2xTo30.xsl lists
    'stimulusBody outcomeElseIf exitTest testFeedback templateDefault variableMapping infoControl ' +
    // irregular, see below
    'durationLT durationGTE incrementSI incrementUS ruleSystemSI ruleSystemUS'
  ).split(' ')
);

/** QTI 2 names whose QTI 3 name is not the plain kabobized form (durationLT -> qti-duration-lt, not qti-duration-l-t). */
const IRREGULAR_QTI2_TO_QTI3: Record<string, string> = {
  durationLT: 'qti-duration-lt',
  durationGTE: 'qti-duration-gte',
  incrementSI: 'qti-increment-si',
  incrementUS: 'qti-increment-us',
  ruleSystemSI: 'qti-rule-system-si',
  ruleSystemUS: 'qti-rule-system-us'
};

/** baseType -> base-type (as in qti2xTo30.xsl) */
export const kabobize = (name: string) => name.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
/** base-type -> baseType */
export const camelize = (name: string) => name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** Converts any name the QTI 3 way; use for names known to be QTI elements. */
export const qtiKabobify = (qti2Name: string) => IRREGULAR_QTI2_TO_QTI3[qti2Name] ?? `qti-${kabobize(qti2Name)}`;

const QTI3_TO_QTI2 = new Map([...QTI2_ELEMENT_NAMES].map(name => [qtiKabobify(name), name]));

/** choiceInteraction -> qti-choice-interaction; null for names that are not QTI elements (e.g. XHTML). */
export const qti2ElementNameToQti3 = (qti2Name: string): string | null =>
  QTI2_ELEMENT_NAMES.has(qti2Name) ? qtiKabobify(qti2Name) : null;

/**
 * qti-choice-interaction -> choiceInteraction; null for names without the qti- prefix.
 * QTI 3 elements that are not in the table (QTI 3-only) fall back to a plain camelCase of the name.
 */
export const qti3ElementNameToQti2 = (qti3Name: string): string | null =>
  qti3Name.startsWith('qti-') ? (QTI3_TO_QTI2.get(qti3Name) ?? camelize(qti3Name.slice('qti-'.length))) : null;
