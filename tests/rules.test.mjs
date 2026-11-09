// Rules tests for firestore.rules. Run: cd tests && npm install && npm test (needs Java).
// Uses fake test accounts only.
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-cube-clock',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
});
after(async () => { await env?.cleanup(); });

const score = (uid, extra = {}) => ({
  uid, name: 'Test Player', group: 'all', puzzle: '333',
  best: 12345, ao5: 15000, ao12: null, solves: 12, updatedAt: 1, ...extra,
});
const profile = (extra = {}) => ({ name: 'Test Player', group: 'all', updatedAt: 1, ...extra });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'players/other'), profile());
    await setDoc(doc(db, 'scores/other__333'), score('other'));
  });
});

const me = () => env.authenticatedContext('me').firestore();
const anon = () => env.unauthenticatedContext().firestore();

test('a signed-out visitor can read the leaderboard', async () => {
  await assertSucceeds(getDocs(collection(anon(), 'scores')));
  await assertSucceeds(getDoc(doc(anon(), 'players/other')));
});
test('a signed-out visitor cannot post a score', async () => {
  await assertFails(setDoc(doc(anon(), 'scores/me__333'), score('me')));
});
test('a player can save and update their own score', async () => {
  await assertSucceeds(setDoc(doc(me(), 'scores/me__333'), score('me')));
  await assertSucceeds(setDoc(doc(me(), 'scores/me__333'), score('me', { best: 11000 })));
});
test('a player can delete their own score', async () => {
  await setDoc(doc(me(), 'scores/me__333'), score('me'));
  await assertSucceeds(deleteDoc(doc(me(), 'scores/me__333')));
});
test('a player cannot change or delete another player\'s score', async () => {
  await assertFails(updateDoc(doc(me(), 'scores/other__333'), { best: 5000 }));
  await assertFails(setDoc(doc(me(), 'scores/other__333'), score('other', { best: 5000 })));
  await assertFails(deleteDoc(doc(me(), 'scores/other__333')));
});
test('a player cannot write a row named for another player', async () => {
  await assertFails(setDoc(doc(me(), 'scores/me__333'), score('other')));
  await assertFails(setDoc(doc(me(), 'scores/other__444'), score('me', { puzzle: '444' })));
});
test('the row id has to match the puzzle in the row', async () => {
  await assertFails(setDoc(doc(me(), 'scores/me__333'), score('me', { puzzle: '444' })));
});
test('times outside 0.3 s to 1 hour are refused', async () => {
  await assertFails(setDoc(doc(me(), 'scores/me__333'), score('me', { best: 100 })));
  await assertFails(setDoc(doc(me(), 'scores/me__333'), score('me', { best: 3600001 })));
  await assertFails(setDoc(doc(me(), 'scores/me__333'), score('me', { ao5: 100 })));
  await assertSucceeds(setDoc(doc(me(), 'scores/me__333'), score('me', { best: 300 })));
});
test('an unknown puzzle, extra field or bad solve count is refused', async () => {
  await assertFails(setDoc(doc(me(), 'scores/me__777'), score('me', { puzzle: '777' })));
  await assertFails(setDoc(doc(me(), 'scores/me__333'), score('me', { admin: true })));
  await assertFails(setDoc(doc(me(), 'scores/me__333'), score('me', { solves: 0 })));
  await assertFails(setDoc(doc(me(), 'scores/me__333'), score('me', { solves: 1.5 })));
});
test('names and group codes are checked', async () => {
  await assertFails(setDoc(doc(me(), 'scores/me__333'), score('me', { name: '' })));
  await assertFails(setDoc(doc(me(), 'scores/me__333'), score('me', { name: 'x'.repeat(17) })));
  await assertFails(setDoc(doc(me(), 'scores/me__333'), score('me', { group: 'Bad Group!' })));
});
test('a player can write their own profile only', async () => {
  await assertSucceeds(setDoc(doc(me(), 'players/me'), profile()));
  await assertFails(setDoc(doc(me(), 'players/other'), profile({ name: 'Hacked' })));
  await assertFails(deleteDoc(doc(me(), 'players/other')));
});
test('a profile cannot carry extra fields', async () => {
  await assertFails(setDoc(doc(me(), 'players/me'), profile({ email: 'a@example.com' })));
});
