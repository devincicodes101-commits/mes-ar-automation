-- =====================================================================
--  MES AR Automation, the five sign-in accounts
--  DeVinci Codes
--
--  Run this in the Supabase SQL editor after 0009_admin_roles.sql.
--
--  WHY THIS IS SQL AND NOT THE SIGN-UP FORM
--
--  Creating these through the API sends a confirmation email each time, and
--  the built-in mailer allows only a couple an hour, so four of the five
--  failed with over_email_send_rate_limit. It also sends mail to real
--  mesgroup.com addresses that nobody is watching. Seeding them here creates
--  them already confirmed and sends nothing.
--
--  SAFE TO RUN TWICE. Every statement is guarded: an account that already
--  exists is confirmed and left alone rather than duplicated, and a profile
--  that already exists has its role corrected.
--
--  THESE ARE DEMO CREDENTIALS. Replace them before anybody outside the
--  project sees this. The passwords are deliberately obvious.
-- =====================================================================

-- crypt() and gen_salt() come from pgcrypto. Supabase installs it in the
-- `extensions` schema, but a project that installed it elsewhere would break a
-- hard-coded `crypt(...)`, so the search path is widened instead of
-- the calls being qualified.
create extension if not exists pgcrypto;
set search_path = public, extensions;

do $$
declare
  people constant jsonb := '[
    {"email":"superadmin@mesgroup.com","pw":"superadmin@2026","name":"Raman Palaniappan","role":"super_admin","rm":null},
    {"email":"admin@mesgroup.com",     "pw":"admin@2026",     "name":"Darren Phua",      "role":"admin",      "rm":null},
    {"email":"csd@mesgroup.com",       "pw":"csd@2026",       "name":"Jacqueline Fong",  "role":"csd",        "rm":null},
    {"email":"rm@mesgroup.com",        "pw":"rm@2026",        "name":"Ray Ang",          "role":"rm",         "rm":"2611 Ray Ang"},
    {"email":"management@mesgroup.com","pw":"management@2026","name":"Management",       "role":"management", "rm":null}
  ]'::jsonb;
  person jsonb;
  uid uuid;
begin
  for person in select * from jsonb_array_elements(people) loop

    select id into uid from auth.users where email = person->>'email';

    if uid is null then
      uid := gen_random_uuid();

      -- The empty strings at the end are not decoration.
      --
      -- GoTrue reads these token columns into plain Go strings rather than
      -- nullable ones, so a NULL fails the row scan and every sign in comes
      -- back as a 500 "Database error querying schema" with no hint that the
      -- row is the problem. Seeding them as '' is the difference between an
      -- account that works and one that looks right and cannot log in.
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data,
        confirmation_token, recovery_token,
        email_change, email_change_token_new, email_change_token_current,
        phone_change, phone_change_token, reauthentication_token
      ) values (
        '00000000-0000-0000-0000-000000000000',
        uid, 'authenticated', 'authenticated',
        person->>'email',
        crypt(person->>'pw', gen_salt('bf')),
        now(), now(), now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('full_name', person->>'name'),
        '', '', '', '', '', '', '', ''
      );

      -- Newer GoTrue will not sign somebody in without a matching identity
      -- row, even when auth.users looks complete.
      insert into auth.identities (
        id, user_id, provider_id, identity_data, provider,
        last_sign_in_at, created_at, updated_at
      ) values (
        gen_random_uuid(), uid, uid::text,
        jsonb_build_object('sub', uid::text, 'email', person->>'email',
                           'email_verified', true, 'phone_verified', false),
        'email', now(), now(), now()
      );

      raise notice 'created %', person->>'email';
    else
      -- Already there, from the sign-up attempt that did go through. Confirm
      -- it and reset the password so the documented one certainly works.
      update auth.users
         set email_confirmed_at = coalesce(email_confirmed_at, now()),
             encrypted_password = crypt(person->>'pw', gen_salt('bf')),
             updated_at         = now(),
             -- Repairs a row seeded before those columns were filled in.
             confirmation_token         = coalesce(confirmation_token, ''),
             recovery_token             = coalesce(recovery_token, ''),
             email_change               = coalesce(email_change, ''),
             email_change_token_new     = coalesce(email_change_token_new, ''),
             email_change_token_current = coalesce(email_change_token_current, ''),
             phone_change               = coalesce(phone_change, ''),
             phone_change_token         = coalesce(phone_change_token, ''),
             reauthentication_token     = coalesce(reauthentication_token, '')
       where id = uid;

      insert into auth.identities (
        id, user_id, provider_id, identity_data, provider,
        last_sign_in_at, created_at, updated_at
      )
      select gen_random_uuid(), uid, uid::text,
             jsonb_build_object('sub', uid::text, 'email', person->>'email',
                                'email_verified', true, 'phone_verified', false),
             'email', now(), now(), now()
      where not exists (
        select 1 from auth.identities
         where user_id = uid and provider = 'email'
      );

      raise notice 'confirmed existing %', person->>'email';
    end if;

    -- The profile is what carries the role. A user with none can
    -- authenticate but is refused by the application, deliberately.
    insert into profiles (id, full_name, role, rm_key)
    values (uid, person->>'name', (person->>'role')::user_role, person->>'rm')
    on conflict (id) do update
      set full_name = excluded.full_name,
          role      = excluded.role,
          rm_key    = excluded.rm_key;

  end loop;
end $$;

-- ------------------------------------------------------------- check it
-- Expect five rows, every one confirmed, each with a role.

select u.email,
       p.full_name,
       p.role,
       p.rm_key,
       (u.email_confirmed_at is not null) as confirmed,
       exists (select 1 from auth.identities i
                where i.user_id = u.id and i.provider = 'email') as has_identity
  from auth.users u
  left join profiles p on p.id = u.id
 where u.email like '%@mesgroup.com'
 order by p.role;
