create extension if not exists pgcrypto;

create table if not exists public.lectures (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  course text not null default '',
  lecture_title text not null default '',
  lecture_date date,
  source_file text not null default '',
  transcript_mode text not null default 'latex',
  transcript text not null default '',
  raw_transcript text not null default '',
  board_context text not null default '',
  board_photo_count integer not null default 0,
  assets jsonb not null default '[]'::jsonb,
  usage jsonb,
  board_usage jsonb,
  formatting_usage jsonb
);

create index if not exists lectures_course_idx on public.lectures (course);
create index if not exists lectures_lecture_date_idx on public.lectures (lecture_date desc);
create index if not exists lectures_created_at_idx on public.lectures (created_at desc);

alter table public.lectures enable row level security;
