const RULES = new Set(['winner', 'loser', 'all_succeed']);
const MONEY_PATTERN = /(?:[$€£¥₹]|\b(?:cash|money|bet|wager|venmo|paypal|dollars?|euros?|pounds?)\b)/i;

export function validateStake(input = {}) {
  const rule = String(input.rule || '').trim();
  const reward = String(input.reward || '').trim();
  const consequence = String(input.consequence || '').trim();
  if (!RULES.has(rule)) throw new Error('Choose a valid stake rule');
  if (!reward && !consequence) throw new Error('Add a reward or consequence');
  if (reward.length > 140 || consequence.length > 140) throw new Error('Keep each stake under 140 characters');
  if (MONEY_PATTERN.test(`${reward} ${consequence}`)) throw new Error('Donezo stakes cannot involve money, cash, betting, or wagering');
  return { rule, reward, consequence };
}

export function canActivateStake(participantIds = [], consents = []) {
  if (!participantIds.length) return false;
  const accepted = new Set(consents.filter((item) => item.status === 'accepted').map((item) => item.userId));
  return participantIds.every((id) => accepted.has(id));
}

export function resolveStake(rule, standings = []) {
  if (!RULES.has(rule)) throw new Error('Unsupported stake rule');
  if (!standings.length) return { winners: [], losers: [], allSucceeded: false };
  const highest = Math.max(...standings.map((item) => Number(item.percent || 0)));
  const lowest = Math.min(...standings.map((item) => Number(item.percent || 0)));
  const allSucceeded = standings.every((item) => Number(item.percent || 0) >= 100);
  if (rule === 'all_succeed') {
    return {
      winners: allSucceeded ? standings.map((item) => item.id) : [],
      losers: allSucceeded ? [] : standings.filter((item) => Number(item.percent || 0) < 100).map((item) => item.id),
      allSucceeded,
    };
  }
  return {
    winners: standings.filter((item) => Number(item.percent || 0) === highest).map((item) => item.id),
    losers: standings.filter((item) => Number(item.percent || 0) === lowest).map((item) => item.id),
    allSucceeded,
  };
}
