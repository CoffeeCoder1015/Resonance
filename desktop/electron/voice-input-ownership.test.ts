import assert from 'node:assert/strict';
import test from 'node:test';

import { VoiceInputOwnership } from './voice-input-ownership.js';

test('a pill claim waits for desktop revocation before it is granted', async () => {
  const ownership = new VoiceInputOwnership();
  let finishRevocation: ((stopped: boolean) => void) | null = null;

  assert.equal(await ownership.claim('desktop', async () => true), true);
  const pillClaim = ownership.claim(
    'pill',
    () => new Promise(resolve => { finishRevocation = resolve; })
  );
  await Promise.resolve();
  assert.equal(ownership.owner, 'desktop');
  finishRevocation!(true);
  assert.equal(await pillClaim, true);
  assert.equal(ownership.owner, 'pill');
});

test('a failed revocation does not grant the competing claim', async () => {
  const ownership = new VoiceInputOwnership();
  await ownership.claim('desktop', async () => true);

  assert.equal(await ownership.claim('pill', async () => false), false);
  assert.equal(ownership.owner, 'desktop');
});

test('a revoked owner cannot release the new owner', async () => {
  const ownership = new VoiceInputOwnership();
  await ownership.claim('desktop', async () => true);
  await ownership.claim('pill', async () => true);

  assert.equal(ownership.release('desktop'), false);
  assert.equal(ownership.owner, 'pill');
  assert.equal(ownership.release('pill'), true);
  assert.equal(ownership.owner, null);
});
