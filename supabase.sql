-- GJR S'gan Hub database schema
create extension if not exists pgcrypto;

create table if not exists councils (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('admin','council_sgan','counterpart')),
  council_id uuid references councils(id) on delete set null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists counterparts (
  id uuid primary key default gen_random_uuid(),
  council_id uuid not null references councils(id) on delete cascade,
  name text not null,
  chapter text not null,
  linked_profile_id uuid unique references profiles(id) on delete set null,
  last_check_in date,
  next_follow_up date,
  notes text default '',
  created_at timestamptz not null default now()
);

create table if not exists check_templates (
  id uuid primary key default gen_random_uuid(),
  council_id uuid references councils(id) on delete cascade,
  title text not null,
  group_name text not null default 'General',
  cadence text not null check (cadence in ('weekly','daily')),
  until_date date,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists check_completions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references check_templates(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  period_key text not null,
  completed_at timestamptz not null default now(),
  unique(template_id,profile_id,period_key)
);

create table if not exists meetings (
  id uuid primary key default gen_random_uuid(),
  council_id uuid references councils(id) on delete cascade,
  title text not null,
  mode text not null check (mode in ('Online','In-Person')),
  start_date date not null,
  start_time time not null,
  end_time time,
  recurrence text not null default 'none' check (recurrence in ('none','weekly','biweekly')),
  url text default '',
  location text default '',
  owner_profile_id uuid references profiles(id) on delete set null,
  visible_regionwide boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists chapter_visits (
  id uuid primary key default gen_random_uuid(),
  council_id uuid not null references councils(id) on delete cascade,
  chapter text not null,
  visit_date date not null,
  went_well text default '',
  needs_help text default '',
  follow_up text default '',
  created_by uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  council_id uuid references councils(id) on delete cascade,
  sender_id uuid not null references profiles(id) on delete cascade,
  recipient_id uuid not null references profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists one_on_one_requests (
  id uuid primary key default gen_random_uuid(),
  council_id uuid not null references councils(id) on delete cascade,
  counterpart_profile_id uuid not null references profiles(id) on delete cascade,
  council_sgan_profile_id uuid not null references profiles(id) on delete cascade,
  requested_date date not null,
  requested_start time not null,
  requested_end time,
  notes text default '',
  status text not null default 'requested' check (status in ('requested','accepted','declined','completed')),
  created_at timestamptz not null default now()
);

alter table councils enable row level security;
alter table profiles enable row level security;
alter table counterparts enable row level security;
alter table check_templates enable row level security;
alter table check_completions enable row level security;
alter table meetings enable row level security;
alter table chapter_visits enable row level security;
alter table messages enable row level security;
alter table one_on_one_requests enable row level security;

create or replace function public.current_profile_role()
returns text language sql stable security definer set search_path=public as $$
  select role from profiles where id=auth.uid()
$$;

create or replace function public.current_council_id()
returns uuid language sql stable security definer set search_path=public as $$
  select council_id from profiles where id=auth.uid()
$$;

create or replace function public.bootstrap_admin_profile()
returns profiles
language plpgsql
security definer
set search_path=public
as $$
declare
  cca uuid;
  p profiles;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into p from profiles where id=auth.uid();
  if p.id is not null then return p; end if;
  if exists(select 1 from profiles where role='admin') then
    raise exception 'Admin already exists';
  end if;
  insert into councils(name,display_name)
    values ('CCAZA','Central Council AZA')
    on conflict(name) do update set display_name=excluded.display_name
    returning id into cca;
  insert into profiles(id,display_name,role,council_id)
    values(auth.uid(),'CCAZA S''gan NOAH ALTER','admin',cca)
    returning * into p;
  return p;
end $$;

grant execute on function public.bootstrap_admin_profile() to authenticated;

-- Read profiles/councils for authenticated users.
create policy "authenticated read councils" on councils for select to authenticated using (true);
create policy "authenticated read profiles" on profiles for select to authenticated using (true);

-- Admin manages councils. Council leaders can read only.
create policy "admin insert councils" on councils for insert to authenticated with check (public.current_profile_role()='admin');
create policy "admin update councils" on councils for update to authenticated using (public.current_profile_role()='admin');
create policy "admin delete councils" on councils for delete to authenticated using (public.current_profile_role()='admin');

-- Profile updates: admin any; council leaders themselves; counterparts themselves.
create policy "profile self or admin update" on profiles for update to authenticated
using (id=auth.uid() or public.current_profile_role()='admin');

-- Counterparts: admin all; council leader own council; counterpart own linked row.
create policy "read counterparts" on counterparts for select to authenticated
using (
  public.current_profile_role()='admin'
  or council_id=public.current_council_id()
  or linked_profile_id=auth.uid()
);
create policy "leaders insert counterparts" on counterparts for insert to authenticated
with check (
  public.current_profile_role()='admin'
  or (public.current_profile_role()='council_sgan' and council_id=public.current_council_id())
);
create policy "leaders update counterparts" on counterparts for update to authenticated
using (
  public.current_profile_role()='admin'
  or (public.current_profile_role()='council_sgan' and council_id=public.current_council_id())
);
create policy "leaders delete counterparts" on counterparts for delete to authenticated
using (
  public.current_profile_role()='admin'
  or (public.current_profile_role()='council_sgan' and council_id=public.current_council_id())
);

create policy "read check templates" on check_templates for select to authenticated
using (council_id is null or public.current_profile_role()='admin' or council_id=public.current_council_id());
create policy "leaders manage check templates" on check_templates for all to authenticated
using (public.current_profile_role()='admin' or (public.current_profile_role()='council_sgan' and council_id=public.current_council_id()))
with check (public.current_profile_role()='admin' or (public.current_profile_role()='council_sgan' and council_id=public.current_council_id()));

create policy "own check completions" on check_completions for select to authenticated
using (profile_id=auth.uid() or public.current_profile_role() in ('admin','council_sgan'));
create policy "own insert check completions" on check_completions for insert to authenticated with check (profile_id=auth.uid());
create policy "own delete check completions" on check_completions for delete to authenticated using (profile_id=auth.uid());

create policy "read meetings" on meetings for select to authenticated
using (
  (visible_regionwide and public.current_profile_role() in ('admin','council_sgan'))
  or public.current_profile_role()='admin'
  or council_id=public.current_council_id()
  or owner_profile_id=auth.uid()
);
create policy "leaders manage meetings" on meetings for all to authenticated
using (
  public.current_profile_role()='admin'
  or (public.current_profile_role()='council_sgan' and (council_id=public.current_council_id() or owner_profile_id=auth.uid()))
)
with check (
  public.current_profile_role()='admin'
  or (public.current_profile_role()='council_sgan' and council_id=public.current_council_id())
);

create policy "read chapter visits" on chapter_visits for select to authenticated
using (public.current_profile_role()='admin' or council_id=public.current_council_id());
create policy "leaders manage chapter visits" on chapter_visits for all to authenticated
using (public.current_profile_role()='admin' or (public.current_profile_role()='council_sgan' and council_id=public.current_council_id()))
with check (public.current_profile_role()='admin' or (public.current_profile_role()='council_sgan' and council_id=public.current_council_id()));

create policy "message participants read" on messages for select to authenticated
using (sender_id=auth.uid() or recipient_id=auth.uid());
create policy "send own messages" on messages for insert to authenticated
with check (
  sender_id=auth.uid()
  and exists(select 1 from profiles a, profiles b where a.id=sender_id and b.id=recipient_id and a.council_id=b.council_id)
);

create policy "1on1 participants read" on one_on_one_requests for select to authenticated
using (counterpart_profile_id=auth.uid() or council_sgan_profile_id=auth.uid() or public.current_profile_role()='admin');
create policy "counterpart request 1on1" on one_on_one_requests for insert to authenticated
with check (counterpart_profile_id=auth.uid() and public.current_profile_role()='counterpart');
create policy "leader update 1on1" on one_on_one_requests for update to authenticated
using (council_sgan_profile_id=auth.uid() or public.current_profile_role()='admin');

-- Seed CCAZA if missing.
insert into councils(name,display_name) values ('CCAZA','Central Council AZA') on conflict(name) do nothing;

-- Seed counterpart directory for CCAZA.
insert into counterparts(council_id,name,chapter,notes)
select c.id,v.name,v.chapter,v.notes
from councils c
cross join (values
 ('Josh Matthews','East Brunswick AZA',''),
 ('Charlie Mason','Marlboro AZA','Home Chapter'),
 ('Ryan Feldman','T''sahal BBYO',''),
 ('Jordan Feldman','Chavi BBYO','Focus Chapter')
) as v(name,chapter,notes)
where c.name='CCAZA'
and not exists(select 1 from counterparts x where x.council_id=c.id and x.name=v.name);

-- Seed recurring leadership checks with the original CCAZA S'gan Hub details.
insert into check_templates(council_id,title,group_name,cadence,until_date)
select c.id,v.title,v.group_name,v.cadence,v.until_date
from councils c
cross join (values
 ('Josh Matthews — East Brunswick AZA','Counterparts','weekly',null::date),
 ('Charlie Mason — Marlboro AZA (Home Chapter)','Counterparts','weekly',null::date),
 ('Ryan Feldman — T''sahal BBYO','Counterparts','weekly',null::date),
 ('Jordan Feldman — Chavi BBYO (Focus Chapter)','Counterparts','weekly',null::date),
 ('Chavi BBYO — POC Madelyn Paradise · +1 (908) 873-8370','Focus Chapters','weekly',null::date),
 ('Marlboro AZA — POC Seth Borenstein · +1 (908) 670-5051','Focus Chapters','weekly',null::date),
 ('Check in on Yacht Party planning + sign-ups','Planning','weekly','2026-10-17'::date),
 ('Check in on FallCon Steering + signups','Daily Priority','daily','2026-11-20'::date)
) as v(title,group_name,cadence,until_date)
where c.name='CCAZA'
and not exists(select 1 from check_templates t where t.council_id=c.id and t.title=v.title);

-- Regionwide S'ganim call stays on every council leader's schedule.
insert into meetings(council_id,title,mode,start_date,start_time,end_time,recurrence,url,visible_regionwide)
select null,'S''ganim Call w/ Max Nachman','Online','2026-09-29','17:00','18:00','weekly','https://bbyo-org.zoom.us/j/81014315071',true
where not exists(select 1 from meetings where title='S''ganim Call w/ Max Nachman' and visible_regionwide=true);

-- CCAZA seed meetings.
insert into meetings(council_id,title,mode,start_date,start_time,end_time,recurrence,url,visible_regionwide)
select c.id,v.title,'Online',v.start_date,v.start_time,v.end_time,v.recurrence,v.url,false
from councils c
cross join (values
 ('1:1 w/ Max Nachman','2026-09-28'::date,'17:00'::time,null::time,'biweekly','https://bbyo-org.zoom.us/j/81844914425'),
 ('Thursday BBYO Meeting','2026-10-01'::date,'18:30'::time,'19:30'::time,'weekly','https://bbyo-org.zoom.us/j/89346459243'),
 ('FallCon Steering Meeting #1','2026-09-28'::date,'18:00'::time,'19:30'::time,'none','https://bbyo-org.zoom.us/j/88681936317')
) as v(title,start_date,start_time,end_time,recurrence,url)
where c.name='CCAZA'
and not exists(select 1 from meetings m where m.council_id=c.id and m.title=v.title);

alter publication supabase_realtime add table messages;
