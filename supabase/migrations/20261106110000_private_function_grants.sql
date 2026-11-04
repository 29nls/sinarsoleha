-- 0018 — Phase 12: revoke default PUBLIC EXECUTE on private functions
-- Additive only: no signature, policy, or grant to a client changes except
-- that `authenticated` keeps exactly the one helper it legitimately calls
-- (`private.has_role`, used inside RLS policies).
--
-- Why: PostgreSQL grants EXECUTE on every new function to PUBLIC by default.
-- The private schema is not exposed through PostgREST and `anon` has no USAGE
-- on it, so this was never reachable (tests I5/I7 prove the call fails with
-- 42501/0A000). It is still a standing invitation: any future mistake that
-- grants USAGE on `private` would silently expose every helper at once.
--
-- Trigger functions do not need EXECUTE for the trigger to fire: PostgreSQL
-- checks the privilege of the table owner, not of the session. Revoking here
-- therefore cannot break `set_updated_at`, the balance checks, the audit
-- guards, or the stock broadcast.

revoke all on all functions in schema private from public;

-- `authenticated` must keep calling has_role: every RLS policy on the 24
-- public tables uses it. Re-grant explicitly so the revoke above cannot
-- accidentally lock the application out of its own policies.
grant execute on function private.has_role(text[]) to authenticated;

-- Every future helper created in this schema starts locked instead of
-- inheriting PUBLIC EXECUTE. The role running migrations owns this default.
alter default privileges in schema private revoke execute on functions from public;
