import * as cheerio from 'cheerio';

/**
 * Metadata for an assessment-item-ref, supplied by the caller because the items are separate
 * files that the test document does not contain.
 */
export interface WrapStimulusInSectionItemMeta {
  /** Identifier of the stimulus the item references, or null/empty when it references none. */
  stimulusIdentifier?: string | null;
  /** Section title to use when this item starts a section. */
  title?: string;
  /** Whether this is an informational (non-question) item that must stay isolated. */
  isInfo?: boolean;
}

export interface WrapStimulusInSectionResolver {
  /**
   * Resolve the metadata for an item-ref given its `href` and `identifier`. Return
   * null/undefined when nothing is known about the item (it is then treated as a single-item
   * section).
   */
  getItemMeta: (
    href: string,
    identifier: string
  ) => Promise<WrapStimulusInSectionItemMeta | null | undefined>;
}

export interface WrapStimulusInSectionOptions {
  /** Item-ref `category` values (substring match, case-insensitive) that mark info items. */
  infoCategories?: string[];
  /** Collects the item-identifier -> section-identifier assignments produced by the rewrite. */
  assignmentsOut?: Array<{ itemIdentifier: string; sectionIdentifier: string }>;
}

const TEST = ['qti-assessment-test', 'assessmentTest'];
const TEST_PART = ['qti-test-part', 'testPart'];
const SECTION = ['qti-assessment-section', 'assessmentSection'];
const ITEM_REF = ['qti-assessment-item-ref', 'assessmentItemRef'];
const NAV_ENTITY_ATTR = 'data-navigation-entity';
const LEGACY_NAV_ATTR = 'data-cito-navigate';

interface ResolvedMeta {
  stimulusIdentifier: string | null;
  title: string;
  isInfo: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type El = any;

function nameOf(el: El): string {
  return el?.tagName ?? el?.name ?? '';
}

function childElems($: cheerio.CheerioAPI, parent: El, names: string[]): El[] {
  return $(parent)
    .children()
    .toArray()
    .filter(e => names.includes(nameOf(e)));
}

function descendantElems($: cheerio.CheerioAPI, parent: El, names: string[]): El[] {
  return $(parent)
    .find('*')
    .toArray()
    .filter(e => names.includes(nameOf(e)));
}

/**
 * Rewrites an assessment test so each navigation step maps to one assessment-section:
 * consecutive items sharing the same stimulus become one section with `keep-together="true"`,
 * info items stay isolated, every other item becomes a single-item section, and the test part
 * is marked with `data-navigation-entity="section"`.
 *
 * Test parts that already consist of a single wrapping section (containing the sub-structure)
 * are left untouched. The document is only mutated when at least one 2+ shared-stimulus cluster
 * is found. Returns whether the document was changed.
 */
export async function wrapStimulusInSection(
  $: cheerio.CheerioAPI,
  resolver: WrapStimulusInSectionResolver,
  options?: WrapStimulusInSectionOptions
): Promise<boolean> {
  const infoCategories = (options?.infoCategories ?? ['dep-informational', 'dep-info']).map(c =>
    c.toLowerCase()
  );

  const testEl = $('*')
    .toArray()
    .find(e => TEST.includes(nameOf(e)));
  if (!testEl) return false;

  const allParts = childElems($, testEl, TEST_PART);

  // A part with a single wrapping section (and no direct item-refs) is already section-shaped.
  const parts = allParts.filter(part => {
    const directSections = childElems($, part, SECTION);
    const directRefs = childElems($, part, ITEM_REF);
    return !(directSections.length === 1 && directRefs.length === 0);
  });

  // Pre-resolve metadata for every item-ref (async), then do the rewrite synchronously.
  const metaByEl = new Map<El, ResolvedMeta>();
  const refsByPart = new Map<El, El[]>();
  for (const part of parts) {
    const refs = descendantElems($, part, ITEM_REF);
    refsByPart.set(part, refs);
    for (const ref of refs) {
      const identifier = ($(ref).attr('identifier') ?? '').trim();
      const href = ($(ref).attr('href') ?? '').trim();
      const category = ($(ref).attr('category') ?? '').toLowerCase();
      const infoByCategory = category.length > 0 && infoCategories.some(c => category.includes(c));

      const resolved = identifier ? await resolver.getItemMeta(href, identifier) : null;

      metaByEl.set(ref, {
        stimulusIdentifier: resolved?.stimulusIdentifier?.trim() || null,
        title: resolved?.title?.trim() || '',
        isInfo: infoByCategory || resolved?.isInfo === true
      });
    }
  }

  const plans = parts
    .map(part => ({ part, clusters: buildClusters(refsByPart.get(part) ?? [], metaByEl) }))
    .filter(p => (refsByPart.get(p.part)?.length ?? 0) > 0);

  if (!plans.some(p => hasSharedStimulusSection(p.clusters, metaByEl))) {
    return false;
  }

  for (const { part, clusters } of plans) {
    normalizeTestPart($, part, clusters, metaByEl, options?.assignmentsOut);
  }

  return true;
}

function buildClusters($metaRefs: El[], metaByEl: Map<El, ResolvedMeta>): El[][] {
  const sections: El[][] = [];
  let i = 0;

  while (i < $metaRefs.length) {
    const meta = metaByEl.get($metaRefs[i])!;

    if (meta.isInfo || !meta.stimulusIdentifier) {
      sections.push([$metaRefs[i]]);
      i++;
      continue;
    }

    const stimulus = meta.stimulusIdentifier;
    const group: El[] = [$metaRefs[i]];
    i++;

    while (i < $metaRefs.length) {
      const next = metaByEl.get($metaRefs[i])!;
      if (next.isInfo || !next.stimulusIdentifier) break;
      if (next.stimulusIdentifier === stimulus) {
        group.push($metaRefs[i]);
        i++;
        continue;
      }
      break;
    }

    sections.push(group);
  }

  return sections;
}

function hasSharedStimulusSection(clusters: El[][], metaByEl: Map<El, ResolvedMeta>): boolean {
  for (const group of clusters) {
    if (group.length < 2) continue;
    const first = metaByEl.get(group[0])!;
    if (first.isInfo || !first.stimulusIdentifier) continue;

    if (
      group.every(r => {
        const m = metaByEl.get(r)!;
        return !m.isInfo && m.stimulusIdentifier === first.stimulusIdentifier;
      })
    ) {
      return true;
    }
  }

  return false;
}

function normalizeTestPart(
  $: cheerio.CheerioAPI,
  part: El,
  clusters: El[][],
  metaByEl: Map<El, ResolvedMeta>,
  assignmentsOut?: Array<{ itemIdentifier: string; sectionIdentifier: string }>
): void {
  const templateSection = descendantElems($, part, SECTION)[0];
  const sectionName = templateSection ? nameOf(templateSection) : 'qti-assessment-section';

  // Detach the item-refs (so they survive emptying the part), then clear the part.
  for (const group of clusters) {
    for (const ref of group) $(ref).remove();
  }
  $(part).empty();

  applyStudentDeliveryHints($, part);

  const partKey = ($(part).attr('identifier') ?? '').trim();
  const sectionPrefix = partKey ? sanitizeSectionPrefix(partKey) : 'PART';

  let sectionIndex = 0;
  for (const group of clusters) {
    sectionIndex++;
    const sectionId = `${sectionPrefix}-SEC-${sectionIndex}`;
    const keepTogether = group.length >= 2;
    const firstMeta = metaByEl.get(group[0]);
    const sectionTitle = firstMeta?.title ?? '';

    const section = $(`<${sectionName}/>`);
    section.attr('identifier', sectionId);
    section.attr('visible', 'true');
    if (sectionTitle) section.attr('title', sectionTitle);
    if (keepTogether) section.attr('keep-together', 'true');

    for (const ref of group) {
      section.append(ref);
      const itemId = ($(ref).attr('identifier') ?? '').trim();
      if (itemId) assignmentsOut?.push({ itemIdentifier: itemId, sectionIdentifier: sectionId });
    }

    $(part).append(section);
  }
}

function applyStudentDeliveryHints($: cheerio.CheerioAPI, part: El): void {
  if (!$(part).attr('navigation-mode')) $(part).attr('navigation-mode', 'nonlinear');
  if (!$(part).attr('submission-mode')) $(part).attr('submission-mode', 'simultaneous');
  $(part).removeAttr(LEGACY_NAV_ATTR);
  $(part).attr(NAV_ENTITY_ATTR, 'section');
}

/** Prefix section identifiers so multi-part tests cannot collide on SEC-n ids. */
function sanitizeSectionPrefix(identifier: string): string {
  const trimmed = identifier.trim();
  if (!trimmed) return 'PART';

  const filtered = [...trimmed.toUpperCase()]
    .filter(ch => /[A-Z0-9_-]/.test(ch))
    .slice(0, 120)
    .join('');

  return filtered || 'PART';
}
