-- Allow at most one positive reaction per person per proof while keeping proof rejection independent.
with ranked_positive_reactions as (
  select
    id,
    row_number() over (
      partition by check_in_id, user_id
      order by created_at desc, id desc
    ) as row_number
  from public.reactions
  where emoji <> '👎'
)
delete from public.reactions reaction
using ranked_positive_reactions ranked
where reaction.id = ranked.id
  and ranked.row_number > 1;

create unique index if not exists reactions_one_positive_per_user_checkin
  on public.reactions(check_in_id, user_id)
  where emoji <> '👎';
