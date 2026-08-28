-- Recipients may mark a nudge read, but must not rewrite its sender, recipient,
-- circle, message, or creation timestamp. Column-level privilege keeps the
-- existing client update safe without restoring broad row mutation access.
grant update (read_at) on table public.nudges to authenticated;

create policy nudges_mark_read_recipient
on public.nudges for update to authenticated
using (to_user_id = (select auth.uid()))
with check (to_user_id = (select auth.uid()));
