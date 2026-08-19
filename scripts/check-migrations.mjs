import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const files = (await readdir(migrationsDir))
  .filter((name) => name.endsWith('.sql'))
  .sort();

// These two files pre-date the timestamp convention and already share the
// historic version "037". Renaming an applied migration would create drift in
// existing Supabase projects, so keep the legacy collision visible but do not
// break current deployments because of it.
const knownLegacyDuplicateVersions = new Set(['037']);
const byVersion = new Map();
const invalidNames = [];

for (const file of files) {
  const match = file.match(/^(\d+)_/);
  if (!match) {
    invalidNames.push(file);
    continue;
  }
  const version = match[1];
  const bucket = byVersion.get(version) ?? [];
  bucket.push(file);
  byVersion.set(version, bucket);
}

const unexpectedDuplicates = [];
for (const [version, names] of byVersion) {
  if (names.length < 2) continue;
  if (knownLegacyDuplicateVersions.has(version)) {
    console.warn(
      `[migrations] known legacy duplicate version ${version}: ${names.join(', ')}`,
    );
    continue;
  }
  unexpectedDuplicates.push({ version, names });
}

if (invalidNames.length > 0 || unexpectedDuplicates.length > 0) {
  if (invalidNames.length > 0) {
    console.error(
      `[migrations] filenames must start with a numeric version followed by _: ${invalidNames.join(', ')}`,
    );
  }
  for (const duplicate of unexpectedDuplicates) {
    console.error(
      `[migrations] duplicate version ${duplicate.version}: ${duplicate.names.join(', ')}`,
    );
  }
  process.exit(1);
}

console.log(`[migrations] checked ${files.length} migration files; version guard passed.`);
