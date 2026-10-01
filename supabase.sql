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
  owner_profile_id uuid not null references profiles(id) on delete cascade,
  assigned_by uuid references profiles(id) on delete set null,
  due_date date,
  title text not null,
  group_name text not null default 'General',
  cadence text not null check (cadence in ('once','weekly','daily')),
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
  mode text not null check (mode in ('Online','In-Person','TBD')),
  start_date date not null,
  start_time time not null,
  end_time time,
  time_tbd boolean not null default false,
  recurrence text not null default 'none' check (recurrence in ('none','weekly','biweekly')),
  url text default '',
  location text default '',
  owner_profile_id uuid not null references profiles(id) on delete cascade,
  counterpart_id uuid references counterparts(id) on delete set null,
  attendee_profile_id uuid references profiles(id) on delete set null,
  contact_type text not null default 'none' check (contact_type in ('none','counterpart','gjr_staff')),
  contact_name text default '',
  notes text not null default '',
  cancelled_dates date[] not null default '{}'::date[],
  visible_regionwide boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists meeting_occurrence_notes (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings(id) on delete cascade,
  occurrence_date date not null,
  owner_profile_id uuid not null references profiles(id) on delete cascade,
  notes text not null default '',
  updated_at timestamptz not null default now(),
  unique(meeting_id, occurrence_date)
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
alter table meeting_occurrence_notes enable row level security;
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

create policy "read own or managed counterpart check templates" on check_templates for select to authenticated
using (
  owner_profile_id=auth.uid()
  or (
    public.current_profile_role()='council_sgan'
    and exists (
      select 1 from profiles target
      where target.id=owner_profile_id
        and target.role='counterpart'
        and target.council_id=public.current_council_id()
    )
  )
  or (
    public.current_profile_role()='admin'
    and exists (
      select 1 from profiles target
      where target.id=owner_profile_id
        and target.role='counterpart'
    )
  )
);
create policy "insert personal or assigned check templates" on check_templates for insert to authenticated
with check (
  (owner_profile_id=auth.uid() and (assigned_by is null or assigned_by=auth.uid()))
  or (
    assigned_by=auth.uid()
    and public.current_profile_role()='council_sgan'
    and exists (
      select 1 from profiles target
      where target.id=owner_profile_id
        and target.role='counterpart'
        and target.council_id=public.current_council_id()
    )
  )
  or (
    assigned_by=auth.uid()
    and public.current_profile_role()='admin'
    and exists (
      select 1 from profiles target
      where target.id=owner_profile_id
        and target.role='counterpart'
    )
  )
);
create policy "update own or assigned check templates" on check_templates for update to authenticated
using (
  owner_profile_id=auth.uid()
  or (
    assigned_by=auth.uid()
    and public.current_profile_role()='council_sgan'
    and exists (
      select 1 from profiles target
      where target.id=owner_profile_id
        and target.role='counterpart'
        and target.council_id=public.current_council_id()
    )
  )
  or (
    assigned_by=auth.uid()
    and public.current_profile_role()='admin'
    and exists (
      select 1 from profiles target
      where target.id=owner_profile_id
        and target.role='counterpart'
    )
  )
)
with check (owner_profile_id=auth.uid() or assigned_by=auth.uid());
create policy "delete own or managed counterpart check templates" on check_templates for delete to authenticated
using (
  owner_profile_id=auth.uid()
  or (
    public.current_profile_role()='council_sgan'
    and exists (
      select 1 from profiles target
      where target.id=owner_profile_id
        and target.role='counterpart'
        and target.council_id=public.current_council_id()
    )
  )
  or (
    public.current_profile_role()='admin'
    and exists (
      select 1 from profiles target
      where target.id=owner_profile_id
        and target.role='counterpart'
    )
  )
);

create policy "read own or managed counterpart completions" on check_completions for select to authenticated
using (
  profile_id=auth.uid()
  or (
    public.current_profile_role()='council_sgan'
    and exists (
      select 1 from profiles target
      where target.id=profile_id
        and target.role='counterpart'
        and target.council_id=public.current_council_id()
    )
  )
  or (
    public.current_profile_role()='admin'
    and exists (
      select 1 from profiles target
      where target.id=profile_id
        and target.role='counterpart'
    )
  )
);
create policy "own insert check completions" on check_completions for insert to authenticated with check (profile_id=auth.uid());
create policy "own delete check completions" on check_completions for delete to authenticated using (profile_id=auth.uid());

create policy "read participating or managed counterpart meetings" on meetings for select to authenticated
using (
  owner_profile_id=auth.uid()
  or attendee_profile_id=auth.uid()
  or (
    public.current_profile_role()='council_sgan'
    and exists (
      select 1 from profiles target
      where target.id=owner_profile_id
        and target.role='counterpart'
        and target.council_id=public.current_council_id()
    )
  )
  or (
    public.current_profile_role()='admin'
    and exists (
      select 1 from profiles target
      where target.id=owner_profile_id
        and target.role='counterpart'
    )
  )
);
create policy "insert own meetings" on meetings for insert to authenticated
with check (owner_profile_id=auth.uid());
create policy "update own meetings" on meetings for update to authenticated
using (owner_profile_id=auth.uid()) with check (owner_profile_id=auth.uid());
create policy "delete own meetings" on meetings for delete to authenticated
using (owner_profile_id=auth.uid());


create policy "meeting participants read occurrence notes" on meeting_occurrence_notes for select to authenticated
using (exists (
  select 1 from meetings m
  where m.id=meeting_id and (m.owner_profile_id=auth.uid() or m.attendee_profile_id=auth.uid())
));
create policy "meeting owner inserts occurrence notes" on meeting_occurrence_notes for insert to authenticated
with check (owner_profile_id=auth.uid() and exists (
  select 1 from meetings m where m.id=meeting_id and m.owner_profile_id=auth.uid()
));
create policy "meeting owner updates occurrence notes" on meeting_occurrence_notes for update to authenticated
using (owner_profile_id=auth.uid() and exists (
  select 1 from meetings m where m.id=meeting_id and m.owner_profile_id=auth.uid()
))
with check (owner_profile_id=auth.uid() and exists (
  select 1 from meetings m where m.id=meeting_id and m.owner_profile_id=auth.uid()
));
create policy "meeting owner deletes occurrence notes" on meeting_occurrence_notes for delete to authenticated
using (owner_profile_id=auth.uid() and exists (
  select 1 from meetings m where m.id=meeting_id and m.owner_profile_id=auth.uid()
));

create policy "read own chapter visits" on chapter_visits for select to authenticated
using (created_by=auth.uid());
create policy "insert own chapter visits" on chapter_visits for insert to authenticated
with check (created_by=auth.uid());
create policy "update own chapter visits" on chapter_visits for update to authenticated
using (created_by=auth.uid()) with check (created_by=auth.uid());
create policy "delete own chapter visits" on chapter_visits for delete to authenticated
using (created_by=auth.uid());

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

-- Personal tasks and meetings are intentionally not seeded. New accounts start blank.

alter publication supabase_realtime add table messages;


-- Program Planning Form workflow
create table if not exists program_planning_forms (
  id uuid primary key default gen_random_uuid(),
  council_id uuid not null references councils(id) on delete cascade,
  submitted_by uuid not null references profiles(id) on delete cascade,
  chapter_name text not null,
  program_name text not null,
  program_date date,
  file_path text not null,
  file_name text not null,
  status text not null default 'submitted' check (status in ('submitted','accepted','needs_changes')),
  council_feedback text default '',
  hidden_by_profiles uuid[] not null default '{}'::uuid[],
  ai_status text not null default 'pending' check (ai_status in ('pending','ready','unavailable','error')),
  ai_summary text default '',
  ai_strengths text default '',
  ai_questions text default '',
  reviewed_by uuid references profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table program_planning_forms enable row level security;
create policy "program forms read" on program_planning_forms for select to authenticated using (submitted_by=auth.uid() or public.current_profile_role()='admin' or (public.current_profile_role()='council_sgan' and council_id=public.current_council_id()));
create policy "chapter sgan submit forms" on program_planning_forms for insert to authenticated with check (submitted_by=auth.uid() and public.current_profile_role()='counterpart' and council_id=public.current_council_id());
create policy "leaders review forms" on program_planning_forms for update to authenticated using (public.current_profile_role()='admin' or (public.current_profile_role()='council_sgan' and council_id=public.current_council_id()));
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types) values ('program-planning-forms','program-planning-forms',false,10485760,array['application/pdf']) on conflict (id) do nothing;
create policy "program pdf upload" on storage.objects for insert to authenticated with check (bucket_id='program-planning-forms' and public.current_profile_role()='counterpart' and (storage.foldername(name))[1]=public.current_council_id()::text and (storage.foldername(name))[2]=auth.uid()::text);
create policy "program pdf read" on storage.objects for select to authenticated using (bucket_id='program-planning-forms' and (owner_id=auth.uid()::text or public.current_profile_role()='admin' or (public.current_profile_role()='council_sgan' and (storage.foldername(name))[1]=public.current_council_id()::text)));

create policy "leaders delete program forms" on program_planning_forms for delete to authenticated
using (
  public.current_profile_role()='admin'
  or (public.current_profile_role()='council_sgan' and council_id=public.current_council_id())
);

create policy "leaders delete program pdf" on storage.objects for delete to authenticated
using (
  bucket_id='program-planning-forms'
  and (
    public.current_profile_role()='admin'
    or (
      public.current_profile_role()='council_sgan'
      and (storage.foldername(name))[1]=public.current_council_id()::text
    )
  )
);

alter table chapter_visits add column if not exists counterpart_id uuid references counterparts(id) on delete set null;

create table if not exists leader_notes (
  id uuid primary key default gen_random_uuid(),
  council_id uuid not null references councils(id) on delete cascade,
  owner_profile_id uuid not null references profiles(id) on delete cascade,
  body text not null default '',
  tagged_counterpart_ids uuid[] not null default '{}'::uuid[],
  shared_counterpart_ids uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table leader_notes enable row level security;
create policy "owners or explicitly shared counterparts read leader notes" on leader_notes for select to authenticated
using (
  owner_profile_id=auth.uid()
  or exists (
    select 1 from counterparts c
    where c.linked_profile_id=auth.uid()
      and c.id=any(shared_counterpart_ids)
  )
);
create policy "owners insert leader notes" on leader_notes for insert to authenticated with check (owner_profile_id=auth.uid());
create policy "owners update leader notes" on leader_notes for update to authenticated using (owner_profile_id=auth.uid()) with check (owner_profile_id=auth.uid());
create policy "owners delete leader notes" on leader_notes for delete to authenticated using (owner_profile_id=auth.uid());
