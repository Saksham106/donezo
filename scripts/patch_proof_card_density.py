from pathlib import Path

APP = Path('src/app.js')
CSS = Path('social.css')

app = APP.read_text()

old_proof_branch = '''  if (activity.proofPath) {
    const actorLabel = mine ? 'You' : esc(actor?.name || 'Friend');
    const actorHandle = !mine && actor?.handle ? ` ${esc(actor.handle)}` : '';
    const invalidLabel = activity.invalid ? ' · cooked 💀' : '';
    return `<article class="activity proof-activity ${activity.invalid ? 'invalid' : ''}" data-check-in="${activity.checkInId}"><div class="proof-card-header"><div class="proof-card-heading-copy"><div class="proof-card-title"><span aria-hidden="true">${esc(activity.emoji)}</span><strong>${esc(activity.habitTitle)}</strong></div><div class="proof-card-byline"><button class="proof-card-author" type="button" data-friend-profile="${activity.userId}" aria-label="Open ${esc(actor?.name || 'friend')} profile">${actorLabel}${actorHandle}${invalidLabel}</button><span>· ${esc(`${formatWhen(activity.when)} · ${formatExactTime(activity.when)}`)}</span><span>· 🔥 ${activity.streak}</span></div></div>${rejectionControl}</div>${proofPreview}${activityMessage ? `<p class="proof-card-note">${esc(activityMessage)}</p>` : ''}${proofActions}${positiveReactions}${proofReplyPreview(activity.checkInId)}${checkIn?.invalid ? '<p class="proof-verdict">Does not count toward streaks or League.</p>' : ''}</article>`;
  }
'''
new_proof_branch = '''  if (activity.proofPath) {
    const actorName = actor?.name || (mine ? me().name : 'Friend');
    const invalidLabel = activity.invalid ? ' · cooked 💀' : '';
    return `<article class="activity proof-activity ${activity.invalid ? 'invalid' : ''}" data-check-in="${activity.checkInId}"><div class="proof-card-header"><div class="proof-card-heading-copy"><div class="proof-card-title"><span aria-hidden="true">${esc(activity.emoji)}</span><strong>${esc(activity.habitTitle)}</strong></div><div class="proof-card-byline"><button class="proof-card-author" type="button" data-friend-profile="${activity.userId}" aria-label="Open ${esc(actorName)} profile">${esc(actorName)}${invalidLabel}</button><span>· ${esc(formatWhen(activity.when))}</span><span>· ${esc(formatExactTime(activity.when))}</span></div></div>${rejectionControl}</div>${proofPreview}${activityMessage ? `<p class="proof-card-note">${esc(activityMessage)}</p>` : ''}${proofActions}${positiveReactions}${proofReplyPreview(activity.checkInId)}${checkIn?.invalid ? '<p class="proof-verdict">Does not count toward streaks or League.</p>' : ''}</article>`;
  }
'''
assert old_proof_branch in app, 'expected proof-card branch not found'
app = app.replace(old_proof_branch, new_proof_branch, 1)
APP.write_text(app)

css = CSS.read_text()
old_header = '.proof-card-header{margin-bottom:var(--space-3)}'
new_header = '.proof-card-header{margin-bottom:var(--space-1)}'
assert old_header in css, 'proof-card header rule missing'
css = css.replace(old_header, new_header, 1)

old_byline = '.proof-card-byline{display:flex;align-items:center;flex-wrap:wrap;gap:.28rem;margin-top:.32rem;color:var(--color-muted);font-size:var(--text-xs);line-height:1.35}'
new_byline = '.proof-card-byline{display:flex;align-items:center;flex-wrap:wrap;gap:.24rem;margin-top:.18rem;color:var(--color-muted);font-size:var(--text-xs);line-height:1.3}'
assert old_byline in css, 'proof-card byline rule missing'
css = css.replace(old_byline, new_byline, 1)

old_reply = '.comment-open{flex:0 0 auto;min-height:var(--size-target-min);border:0;background:transparent;color:var(--color-muted);font-size:var(--text-xs);font-weight:800}'
new_reply = '.comment-open{flex:0 0 auto;min-width:4.75rem;min-height:var(--size-target-min);padding:0 .7rem;border:0;background:transparent;color:var(--color-muted);font-size:var(--text-sm);font-weight:800;text-align:center}'
assert old_reply in css, 'Reply rule missing'
css = css.replace(old_reply, new_reply, 1)
CSS.write_text(css)
