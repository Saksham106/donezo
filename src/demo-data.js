function dayOffset(dateKey, offset) {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function createDemoState(todayKey) {
  return {
    currentUserId: 'saksham',
    circleName: 'Donezo Crew',
    members: [
      { id: 'saksham', name: 'Saksham', handle: '@sak', avatar: 'S', xp: 760, currentStreak: 9, bestStreak: 18 },
      { id: 'john', name: 'John', handle: '@john', avatar: 'J', xp: 830, currentStreak: 14, bestStreak: 22 },
      { id: 'alex', name: 'Alex', handle: '@alex', avatar: 'A', xp: 690, currentStreak: 6, bestStreak: 13 },
      { id: 'bob', name: 'Bob', handle: '@bob', avatar: 'B', xp: 310, currentStreak: 2, bestStreak: 8 }
    ],
    habits: [
      { id: 'wake', ownerId: 'saksham', title: 'Wake up before 8:30', emoji: '⏰', frequency: 'daily', targetTime: '08:30', proofMode: 'photo', xp: 15, active: true },
      { id: 'deep', ownerId: 'saksham', title: '3 hours deep work', emoji: '🧠', frequency: 'daily', targetTime: '18:00', proofMode: 'none', xp: 20, active: true },
      { id: 'gym', ownerId: 'saksham', title: 'Gym', emoji: '🏋️', frequency: 'daily', targetTime: '20:00', proofMode: 'none', xp: 15, active: true },
      { id: 'run', ownerId: 'saksham', title: 'Run 1 mile', emoji: '🏃', frequency: 'daily', targetTime: '19:00', proofMode: 'photo', xp: 20, active: true },
      { id: 'screen', ownerId: 'saksham', title: '< 2h social media', emoji: '📵', frequency: 'daily', targetTime: '22:30', proofMode: 'photo', xp: 25, active: true }
    ],
    checkIns: [
      { id: 'c1', habitId: 'wake', userId: 'saksham', date: todayKey, completedAt: `${todayKey}T08:03:00`, proofUrl: null },
      { id: 'c2', habitId: 'deep', userId: 'saksham', date: todayKey, completedAt: `${todayKey}T13:12:00`, proofUrl: null },
      { id: 'c3', habitId: 'gym', userId: 'saksham', date: todayKey, completedAt: `${todayKey}T14:44:00`, proofUrl: null },
      ...[1,2,3,4,5,6,7,8].map((n) => ({ id: `hist-${n}-wake`, habitId: 'wake', userId: 'saksham', date: dayOffset(todayKey, -n), completedAt: `${dayOffset(todayKey, -n)}T08:10:00`, proofUrl: null }))
    ],
    friendActivities: [
      { id: 'fa1', userId: 'john', type: 'completed', habitTitle: 'Morning run', emoji: '🏃', when: '22m', streak: 14, message: '5.4 km before breakfast. light work.' },
      { id: 'fa2', userId: 'alex', type: 'completed', habitTitle: 'Gym', emoji: '🏋️', when: '48m', streak: 6, message: 'Almost skipped. Didn’t.' },
      { id: 'fa3', userId: 'bob', type: 'overdue', habitTitle: 'Wake up before 8', emoji: '💀', when: '2h overdue', streak: 2, message: 'Bob is currently selling the squad.' },
      { id: 'fa4', userId: 'john', type: 'completed', habitTitle: 'Read 20 pages', emoji: '📚', when: '3h', streak: 21, message: 'Chapter done.' }
    ],
    nudges: []
  };
}
