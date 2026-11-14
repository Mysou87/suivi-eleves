-- Période active choisie à la main, COURS PAR COURS — à exécuter dans
-- l'éditeur SQL de Supabase. Relançable sans risque : ne remet aucune période
-- à 1 si elle a déjà été changée.
--
-- Le passage d'un cours à la période suivante ne dépend plus du calendrier :
-- la professeure clique « Passer en P2 » pour ce cours sur la page
-- `periode.html`, en ligne. Ce clic fige d'abord les bulletins du cours (tout
-- ce qui est encodé à ce moment-là compte), pour que l'élève continue à voir
-- son résultat, puis fait passer le cours à la période suivante.
--
-- La clé anon publiée ne peut toujours rien écrire : tout passe par la fonction
-- `suivi_switch_period`, qui vérifie un mot de passe rangé en base (haché,
-- illisible depuis l'extérieur). Le mot de passe n'apparait dans aucun fichier
-- publié : il se règle avec la commande donnée tout en bas, à taper soi-même.

-- ------------------------------------------------- période de chaque cours

alter table suivi_courses
  add column if not exists active_period int not null default 1
  check (active_period between 1 and 3);

-- ------------------------------------------------------- secrets (illisibles)

create table if not exists suivi_private (
  key   text primary key,
  value text not null
);
alter table suivi_private enable row level security;  -- aucune policy : personne ne lit
revoke all on suivi_private from anon, authenticated;

-- --------------------------------------------- changer la période d'un cours

drop function if exists suivi_switch_period(text, int, jsonb);

create or replace function suivi_switch_period(
  p_password  text,
  p_course_id bigint,
  p_period    int,
  p_snapshots jsonb default '[]'::jsonb
) returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  stored   text;
  inserted int := 0;
begin
  select value into stored from suivi_private where key = 'period_password';
  if stored is null then
    raise exception 'Aucun mot de passe réglé (voir sql/periode.sql).';
  end if;
  if crypt(coalesce(p_password, ''), stored) <> stored then
    perform pg_sleep(1);  -- freine les essais au hasard
    raise exception 'Mot de passe incorrect.';
  end if;
  if p_period not between 1 and 3 then
    raise exception 'Période inconnue : %', p_period;
  end if;
  if not exists (select 1 from suivi_courses where id = p_course_id) then
    raise exception 'Cours inconnu : %', p_course_id;
  end if;

  -- Bulletins de la période qui se termine, pour CE cours uniquement. Un
  -- bulletin déjà figé n'est jamais modifié.
  insert into suivi_snapshots
    (student_id, course_id, period, dl, quiz, validations, bex_diff, depassements,
     exam_level, level, target_level, detail)
  select s.student_id, s.course_id, s.period, s.dl, s.quiz, s.validations, s.bex_diff,
         s.depassements, s.exam_level, s.level, s.target_level, coalesce(s.detail, '{}'::jsonb)
  from jsonb_to_recordset(coalesce(p_snapshots, '[]'::jsonb)) as s(
    student_id uuid, course_id bigint, period int, dl int, quiz int, validations int,
    bex_diff int, depassements int, exam_level text, level text, target_level text, detail jsonb)
  where s.course_id = p_course_id
  on conflict (student_id, course_id, period) do nothing;
  get diagnostics inserted = row_count;

  update suivi_courses set active_period = p_period where id = p_course_id;

  return inserted;
end;
$$;

revoke all on function suivi_switch_period(text, bigint, int, jsonb) from public;
grant execute on function suivi_switch_period(text, bigint, int, jsonb) to anon;

-- Reste éventuel d'une première version (période unique pour toute l'app).
drop table if exists suivi_settings;

-- ------------------------------------------------------ régler le mot de passe
--
-- À exécuter UNE fois, séparément, en remplaçant le texte entre guillemets.
-- Ne jamais l'enregistrer dans ce fichier : le dépôt est public.
--
--   insert into suivi_private (key, value)
--   values ('period_password', extensions.crypt('TON MOT DE PASSE', extensions.gen_salt('bf')))
--   on conflict (key) do update set value = excluded.value;
