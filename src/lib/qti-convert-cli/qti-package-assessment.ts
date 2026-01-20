#!/usr/bin/env node

import { writeFileSync } from 'fs';
import path from 'path';
import { createAssessmentTest } from '../qti-helper-node';

const folderLocation = process.argv[2];

if (!folderLocation) {
  console.error('Please provide a folder location as an argument.');
  process.exit(1);
}

try {
  const invocationCwd = process.env.INIT_CWD ?? process.cwd();
  const resolvedFolderLocation = path.resolve(invocationCwd, folderLocation);
  const assessment = await createAssessmentTest(resolvedFolderLocation);
  writeFileSync(path.join(resolvedFolderLocation, 'test.xml'), assessment);
  console.log('Successfully added an assessment.');
} catch (error) {
  console.error(error);
  process.exit(1);
}
