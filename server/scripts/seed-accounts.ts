import 'dotenv/config';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomInt } from 'crypto';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from '../models/User';
import type { UserRole } from '../models/User';

// Seeds the pre-created accounts (CareCompanionTBI participants + researcher and
// guest test accounts) and writes a plaintext master list CSV for the research
// team. See login-precreated-accounts-spec.md.
//
// Idempotent: existing usernames (matched case-insensitively) are skipped, so
// re-running never duplicates and never touches existing dev/test accounts.
//
// The CSV holds PLAINTEXT access codes. It is written OUTSIDE the repo by default
// and is gitignored (credentials*.csv). Upload it to the lab's secure storage,
// then delete the local copy. Since the DB stores only bcrypt hashes, a skipped
// account's code cannot be recovered — re-generation is the only path.
//
// Run:  npm run seed:accounts           (writes ~/carecompanion-credentials-<ts>.csv)
//       CREDENTIALS_OUT=/path/file.csv npm run seed:accounts

// Access code: 8 uppercase letters, A–Z excluding O (25 letters, ~37 bits).
const CODE_CHARS = 'ABCDEFGHIJKLMNPQRSTUVWXYZ'.replace('O', '');
const CODE_LENGTH = 8;

interface Group {
  prefix: string;
  count: number;
  role: UserRole;
}

const GROUPS: Group[] = [
  { prefix: 'CCT', count: 50, role: 'participant' }, // CareCompanionTBI participants
  { prefix: 'CODA', count: 20, role: 'researcher' }, // CODA Lab researcher test accounts
  { prefix: 'GUEST', count: 20, role: 'guest' }, // public / passerby test accounts
];

const pad2 = (n: number): string => String(n).padStart(2, '0');

function generateCode(existing: Set<string>): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_CHARS[randomInt(CODE_CHARS.length)];
    if (!existing.has(code)) {
      existing.add(code);
      return code;
    }
  }
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/chatbot';
  await mongoose.connect(uri);
  console.log('Connected to:', uri.replace(/\/\/[^@]*@/, '//***@'));

  const usedCodes = new Set<string>();
  const created: Array<{ username: string; code: string; role: UserRole }> = [];
  let skipped = 0;

  for (const { prefix, count, role } of GROUPS) {
    for (let i = 1; i <= count; i++) {
      const username = `${prefix}${pad2(i)}`;

      // Case-insensitive existence check so we never create CCT01 alongside an
      // existing cct01, and never disturb accounts that are already there.
      const existing = await User.findOne({ username }).collation({ locale: 'en', strength: 2 });
      if (existing) {
        skipped++;
        continue;
      }

      const code = generateCode(usedCodes);
      const passwordHash = await bcrypt.hash(code, 12);
      await User.create({ username, passwordHash, role });
      created.push({ username, code, role });
    }
  }

  await mongoose.disconnect();

  const bar = '='.repeat(72);
  if (created.length === 0) {
    console.log(`\nNo new accounts created — all ${skipped} target usernames already exist.`);
    console.log('(Existing codes are hashed and cannot be re-exported. No CSV written.)\n');
    return;
  }

  const outPath =
    process.env.CREDENTIALS_OUT ??
    path.join(os.homedir(), `carecompanion-credentials-${timestamp()}.csv`);

  const rows = created.map(r => `${r.username},${r.code},${r.role}`).join('\n');
  fs.writeFileSync(outPath, `username,accessCode,role\n${rows}\n`, { encoding: 'utf8', mode: 0o600 });

  console.log(`\n${bar}`);
  console.log('  CREDENTIALS WRITTEN — PLAINTEXT ACCESS CODES, HANDLE WITH CARE');
  console.log(bar);
  console.log(`  File:    ${outPath}`);
  console.log(`  Created: ${created.length} new account(s)`);
  console.log(`  Skipped: ${skipped} account(s) that already existed`);
  console.log('  ---');
  console.log('  • Do NOT commit this file. Upload it to the lab secure storage (Dropbox),');
  console.log('    then delete the local copy.');
  console.log('  • Skipped accounts are NOT listed — their codes are hashed and unrecoverable.');
  console.log(`${bar}\n`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
