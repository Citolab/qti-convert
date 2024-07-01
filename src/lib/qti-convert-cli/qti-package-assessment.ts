#!/usr/bin/env node
import { writeFileSync } from 'fs';
import { createAssessmentTest } from '../qti-helper';

const folderLocation = process.argv[2];

if (!folderLocation) {
  console.error('Please provide a folder location as an argument.');
  process.exit(1);
}

try {
  const assessment = await createAssessmentTest(folderLocation);
  writeFileSync(`${folderLocation}/test.xml`, assessment);
  console.log('Successfully added an assessment.');
} catch (error) {
  console.error(error);
  process.exit(1);
}
