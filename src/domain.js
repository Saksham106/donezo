export function dailyProgress(completed, total) {
  const safeTotal = Math.max(0, total);
  const safeCompleted = Math.min(Math.max(0, completed), safeTotal);
  const ratio = safeTotal === 0 ? 0 : safeCompleted / safeTotal;
  return { completed: safeCompleted, total: safeTotal, ratio, percent: Math.round(ratio * 100) };
}

export function calculateStreak(dateStrings, todayString) {
  const completed = new Set(dateStrings);
  const cursor = new Date(`${todayString}T12:00:00Z`);
  let streak = 0;
  while (true) {
    const key = cursor.toISOString().slice(0, 10);
    if (!completed.has(key)) break;
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

export function rankMembers(members) {
  return [...members].sort((a, b) => b.xp - a.xp || a.name.localeCompare(b.name)).map((member, index) => ({ ...member, rank: index + 1 }));
}
