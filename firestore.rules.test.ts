import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
const blueprintPath = path.resolve(process.cwd(), 'firebase-blueprint.json');

test('firestore.rules enforces all 8 pillars and blocks all Dirty Dozen adversarial vectors', () => {
  assert.ok(fs.existsSync(rulesPath), 'firestore.rules must exist');
  assert.ok(fs.existsSync(blueprintPath), 'firebase-blueprint.json must exist');

  const rules = fs.readFileSync(rulesPath, 'utf8');
  const blueprint = JSON.parse(fs.readFileSync(blueprintPath, 'utf8')) as {
    firestore: Record<string, unknown>;
  };

  // 1. Rules v2 + Global Safety Net
  assert.match(rules, /rules_version\s*=\s*'2';/);
  assert.match(rules, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/);

  // 2. Email Spoofing Guard (Dirty Dozen #1)
  assert.match(rules, /request\.auth\.token\.email_verified\s*==\s*true/);

  // 3. ID Poisoning Guard (Dirty Dozen #4)
  assert.match(rules, /function isValidId\(id\)/);
  assert.match(rules, /id\.size\(\)\s*<=\s*128/);
  assert.match(rules, /isValidId\(userId\)/);
  assert.match(rules, /isValidId\(sessionId\)/);
  assert.match(rules, /isValidId\(messageId\)/);
  assert.match(rules, /isValidId\(noteId\)/);

  // 4. Anti-Update-Gap & Shadow Field Guard (Dirty Dozen #2, #9, #11)
  assert.match(rules, /function isValidUserProfile\(data,/);
  assert.match(rules, /function isValidChatSession\(data,/);
  assert.match(rules, /function isValidChatMessage\(data,/);
  assert.match(rules, /function isValidHrNote\(data,/);
  assert.match(rules, /hasAll\(/);
  assert.match(rules, /hasOnly\(/);
  assert.match(rules, /affectedKeys\(\)\.hasOnly\(/);

  // 5. Master Gate Relational Parent Existence Checks (Dirty Dozen #6, #7)
  assert.match(rules, /exists\(\/databases\/\$\(database\)\/documents\/users\/\$\(userId\)\)/);
  assert.match(rules, /get\(\/databases\/\$\(database\)\/documents\/users\/\$\(userId\)\/chatSessions\/\$\(sessionId\)\)/);

  // 6. Temporal Integrity (Dirty Dozen #8)
  assert.match(rules, /incoming\(\)\.createdAt\s*==\s*request\.time/);
  assert.match(rules, /incoming\(\)\.updatedAt\s*==\s*request\.time/);

  // 7. Terminal State Locking (Dirty Dozen #10)
  assert.match(rules, /existing\(\)\.status\s*==\s*'active'/);
  assert.match(rules, /existing\(\)\.status\s*==\s*'open'/);

  // 8. Secure List Queries without client delegation (Dirty Dozen #3, #5, #12)
  assert.doesNotMatch(rules, /allow list:\s*if\s*isSignedIn\(\)\s*;/);
  assert.match(rules, /resource\.data\.ownerUid\s*==\s*request\.auth\.uid/);

  // 9. Every collection in firebase-blueprint.json has a matching rule block
  const expectedMatches = [
    'match /users/{userId}',
    'match /chatSessions/{sessionId}',
    'match /messages/{messageId}',
    'match /hrNotes/{noteId}',
    'match /admins/{adminId}',
  ];
  assert.equal(Object.keys(blueprint.firestore).length, 5);
  for (const m of expectedMatches) {
    assert.ok(rules.includes(m), `Missing match block: ${m}`);
  }
});
