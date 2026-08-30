import test from 'node:test';
import assert from 'node:assert/strict';

const stakes = await import('../src/stakes.js').catch(() => ({}));

test('stake validation keeps rewards social and blocks money wagering', () => {
  assert.equal(typeof stakes.validateStake, 'function');
  assert.deepEqual(stakes.validateStake({
    rule: 'all_succeed',
    reward: 'Pick Friday dinner',
    consequence: 'Post a funny selfie',
  }), {
    rule: 'all_succeed',
    reward: 'Pick Friday dinner',
    consequence: 'Post a funny selfie',
  });
  assert.throws(() => stakes.validateStake({ rule: 'winner', reward: '$20 cash', consequence: '' }), /money|cash|wager/i);
});

test('stake activation requires every participant to opt in', () => {
  assert.equal(stakes.canActivateStake(['a', 'b'], [{ userId: 'a', status: 'accepted' }, { userId: 'b', status: 'accepted' }]), true);
  assert.equal(stakes.canActivateStake(['a', 'b'], [{ userId: 'a', status: 'accepted' }, { userId: 'b', status: 'pending' }]), false);
  assert.equal(stakes.canActivateStake(['a', 'b'], [{ userId: 'a', status: 'accepted' }, { userId: 'b', status: 'declined' }]), false);
});

test('stake resolution is deterministic for supported rules and ties', () => {
  const standings = [{ id: 'a', percent: 100 }, { id: 'b', percent: 75 }, { id: 'c', percent: 75 }];
  assert.deepEqual(stakes.resolveStake('winner', standings), { winners: ['a'], losers: ['b', 'c'], allSucceeded: false });
  assert.deepEqual(stakes.resolveStake('loser', standings), { winners: ['a'], losers: ['b', 'c'], allSucceeded: false });
  assert.deepEqual(stakes.resolveStake('all_succeed', [{ id: 'a', percent: 100 }, { id: 'b', percent: 100 }]), { winners: ['a', 'b'], losers: [], allSucceeded: true });
});
