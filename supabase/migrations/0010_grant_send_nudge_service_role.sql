-- Edge Functions use the service role to read the canonical nudge scope and
-- recipient subscriptions, and to prune expired subscriptions after a 404/410.
-- Keep this grant deliberately narrow: no insert/update access and no delete
-- access outside push_subscriptions.
grant select on table public.nudges to service_role;
grant select on table public.circle_members to service_role;
grant select on table public.profiles to service_role;
grant select, delete on table public.push_subscriptions to service_role;
