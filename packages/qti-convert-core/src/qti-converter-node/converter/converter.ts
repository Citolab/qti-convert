import { cleanXMLString } from '../../qti-helper';
import { upgradeQti2toQti3 } from '../../qti-upgrader';

export const convertQti2toQti3 = async (qti2: string): Promise<string> => upgradeQti2toQti3(cleanXMLString(qti2));
