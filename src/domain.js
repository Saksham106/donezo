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

export function calculateBestStreak(dateStrings) {
  const dates = [...new Set(dateStrings)].sort();
  let best = 0;
  let current = 0;
  let previous = null;
  for (const date of dates) {
    const day = new Date(`${date}T12:00:00Z`);
    const consecutive = previous && day.getTime() - previous.getTime() === 86_400_000;
    current = consecutive ? current + 1 : 1;
    best = Math.max(best, current);
    previous = day;
  }
  return best;
}

export function rankMembers(members) {
  return [...members].sort((a, b) => b.xp - a.xp || a.name.localeCompare(b.name)).map((member, index) => ({ ...member, rank: index + 1 }));
}
