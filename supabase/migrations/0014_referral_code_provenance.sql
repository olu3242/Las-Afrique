-- ---------------------------------------------------------------------------
-- Referral attribution — stop storing the invitation token in the clear.
--
-- Found by the hosted browser journey, and it is a schema defect rather than a
-- test one.
--
-- `attribute_referral` resolved an invitation by its hash and then wrote the
-- *plaintext* token into `referrals.code`. That column is readable by both
-- parties to the referral. `referral_invitations.token_hash` exists exactly so
-- that reading a row never hands anybody a working credential, and this put
-- the credential straight back in the clear one table over.
--
-- The exposure was narrow — the token is single-use, and by the time the row
-- exists the invitation it belongs to has already been accepted and closed, so
-- it is spent. It is fixed anyway: a credential stored in plaintext next to a
-- column deliberately hashed is the kind of thing that becomes a real leak the
-- moment someone reuses the field.
--
-- What is stored instead is the referrer's own code, which is the meaningful
-- provenance and is not a secret. `invitation_id` already records that the
-- attribution came through an invitation rather than a shared link, so nothing
-- is lost. It is null when the referrer has no code for that programme, hence
-- the constraint change below.
-- ---------------------------------------------------------------------------

alter table public.referrals alter column code drop not null;

comment on column public.referrals.code is
  'The referrer''s own shareable code, or null when they had none. Never an '
  'invitation token: those are credentials and are stored hashed.';

create or replace function public.attribute_referral(
  candidate text,
  hashed_token text,
  touched_at timestamptz
)
returns table (outcome text, referral_state public.referral_state)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  caller_email text;
  invite public.referral_invitations%rowtype;
  code_row public.referral_codes%rowtype;
  program public.referral_programs%rowtype;
  referrer uuid;
  invitation uuid;
  resolved_code text;
  touch timestamptz;
begin
  if caller is null then
    return query select 'invalid'::text, null::public.referral_state;
    return;
  end if;

  -- Already attributed: report it rather than failing. A user who follows a
  -- second link should not see an error, and the first attribution stands.
  if exists (select 1 from public.referrals r where r.referred_user_id = caller) then
    return query
      select 'already_attributed'::text, r.state
        from public.referrals r where r.referred_user_id = caller;
    return;
  end if;

  -- An invitation token first: it identifies which invitation converted, and
  -- an invitation carries its own address to check self-referral against.
  select * into invite from public.referral_invitations i
   where i.token_hash = hashed_token
   limit 1;

  if found then
    if invite.state <> 'pending' or invite.expires_at < now() then
      return query select 'expired_invitation'::text, null::public.referral_state;
      return;
    end if;
    referrer := invite.user_id;
    invitation := invite.id;
    program := (select p from public.referral_programs p where p.key = invite.program_key);

    -- NOT `candidate`. On this path the candidate is the invitation token —
    -- a credential, stored hashed in referral_invitations precisely so that
    -- reading a row never yields a working one. Writing it here in the clear,
    -- into a column both parties can read, would undo that.
    --
    -- The referrer's own code is the meaningful provenance and is not a
    -- secret; `invitation_id` already records that this came through an
    -- invitation. Null when the referrer has no code for this programme,
    -- which is why 0014 drops the not-null constraint.
    select c.code into resolved_code from public.referral_codes c
     where c.user_id = invite.user_id and c.program_key = invite.program_key;
  else
    select * into code_row from public.referral_codes c
     where c.code = upper(candidate)
     limit 1;

    if not found then
      return query select 'unknown_code'::text, null::public.referral_state;
      return;
    end if;

    referrer := code_row.user_id;
    invitation := null;
    resolved_code := code_row.code;
    program := (select p from public.referral_programs p where p.key = code_row.program_key);
  end if;

  if referrer = caller then
    return query select 'self_referral'::text, null::public.referral_state;
    return;
  end if;

  -- The same person under a second address is still the same person. Compared
  -- normalised, so a plus-tag or a gmail dot does not defeat it.
  select u.email into caller_email from auth.users u where u.id = caller;
  if exists (
    select 1 from auth.users u
     where u.id = referrer
       and public.normalise_email(u.email) = public.normalise_email(caller_email)
  ) then
    return query select 'self_referral'::text, null::public.referral_state;
    return;
  end if;

  touch := least(touched_at, now());
  if touch < now() - make_interval(days => program.attribution_window_days) then
    return query select 'outside_window'::text, null::public.referral_state;
    return;
  end if;

  -- The touch has to come *before* the account, or this is not a referral.
  --
  -- This is what makes it safe to attempt attribution at sign-in as well as at
  -- signup, which the engine has to do: on a project with email confirmation
  -- enabled there is no session at signup, so signup alone would never
  -- attribute anything. Attempting it at sign-in would otherwise credit a
  -- referrer whenever a long-standing user happened to click a friend's link.
  -- `created_at` is not a column the caller can forge.
  if exists (
    select 1 from auth.users u where u.id = caller and u.created_at < touch
  ) then
    return query select 'existing_account'::text, null::public.referral_state;
    return;
  end if;

  insert into public.referrals
    (program_key, referrer_id, referred_user_id, invitation_id, code, touched_at)
  values
    (program.key, referrer, caller, invitation, resolved_code, touch);

  if invitation is not null then
    update public.referral_invitations
       set state = 'accepted', accepted_by = caller, updated_at = now()
     where id = invitation;
  end if;

  return query select 'attributed'::text, 'joined'::public.referral_state;
exception
  -- The unique constraint is the real concurrency control. Two simultaneous
  -- attributions of the same user leave exactly one row; the loser reports the
  -- same thing it would have reported had it read first.
  when unique_violation then
    return query
      select 'already_attributed'::text, r.state
        from public.referrals r where r.referred_user_id = caller;
end;
$$;

revoke execute on function public.attribute_referral(text, text, timestamptz) from public;
grant execute on function public.attribute_referral(text, text, timestamptz) to authenticated;
