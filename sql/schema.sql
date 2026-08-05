-- Suivi de progression des élèves — schéma Supabase
--
-- À coller dans l'éditeur SQL de Supabase (projet iuharjafrhwzhhggwzgy, celui
-- de Leitner) et exécuter une seule fois. Le script est idempotent : le relancer
-- ne casse rien.
--
-- La table `students` est partagée avec l'app Leitner : on ne fait que lui
-- ajouter une colonne `class_name`. Tout le reste est préfixé `suivi_`.
--
-- Attention : `students.id` est un uuid (et non un entier), donc toutes les
-- colonnes `student_id` sont de type uuid.

-- ---------------------------------------------------------------- élèves

alter table students add column if not exists class_name text;

comment on column students.class_name is
  'Classe de l''élève (4A, 5B, 6C…). Renseignée par l''import du classeur de cotes.';

-- ------------------------------------------------- cours et nomenclature

-- Un enregistrement par ONGLET de résultats. La lettre d'un onglet est un
-- groupe, pas une classe : « 5e Chimie A » contient des élèves de 5A à 5D.
create table if not exists suivi_courses (
  id            bigserial primary key,
  sheet_name    text not null unique,        -- « 5e Chimie A »
  course_label  text not null,               -- « 5e Chimie » (feuilles Liste et Seuils)
  year_level    int,                         -- 4, 5, 6
  group_letter  text,                        -- A, B, C… ou null
  teacher       text not null default 'LVO',
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- Correspondance des libellés quand ils diffèrent d'une feuille à l'autre
-- (onglet « 4e Option » → « 4e Option Sciences » dans la feuille Liste).
create table if not exists suivi_course_aliases (
  course_label text not null,
  alias        text not null,
  primary key (course_label, alias)
);

-- Noms des BEX, des quiz, des rôles de mission et des types de dépassement,
-- lus dans la feuille « Liste ».
create table if not exists suivi_items (
  id           bigserial primary key,
  course_label text not null,
  kind         text not null check (kind in ('bex', 'quiz', 'role', 'depassement')),
  position     int not null,
  label        text not null,
  unique (course_label, kind, position)
);

-- --------------------------------------------------------------- seuils

-- Recopiés de la feuille « Seuils de réussite » à chaque import : c'est elle
-- qui fait foi, jamais le code.
create table if not exists suivi_thresholds (
  id             bigserial primary key,
  course_label   text not null,
  period         int  not null check (period between 1 and 3),
  level          text not null check (level in ('JS', 'S', 'B', 'TB')),
  dl             int not null default 0,
  quiz           int not null default 0,
  validations    int not null default 0,
  bex_diff       int not null default 0,
  depassements   int not null default 0,
  exam_condition text,
  unique (course_label, period, level)
);

-- BEX socles, exigées en période 3 seulement.
create table if not exists suivi_socle (
  course_label text primary key,
  bex_numbers  int[] not null default '{}'
);

-- --------------------------------------------------------------- imports

create table if not exists suivi_imports (
  id          bigserial primary key,
  imported_at timestamptz not null default now(),
  file_name   text,
  source      text not null default 'manuel' check (source in ('manuel', 'sheets')),
  warnings    jsonb not null default '[]',
  summary     jsonb not null default '{}'
);

create table if not exists suivi_enrollments (
  id         bigserial primary key,
  student_id uuid not null references students(id) on delete cascade,
  course_id  bigint not null references suivi_courses(id) on delete cascade,
  class_name text,
  is_active  boolean not null default true,
  unique (student_id, course_id)
);

-- ------------------------------------------------------------- compteurs

-- État courant, remplacé à chaque import. Les dates des devoirs libres et des
-- quiz sont conservées pour pouvoir recalculer les compteurs à n'importe quelle
-- date sans réimporter (fin de période, bulletin figé…).
create table if not exists suivi_counters (
  id              bigserial primary key,
  student_id      uuid not null references students(id) on delete cascade,
  course_id       bigint not null references suivi_courses(id) on delete cascade,
  dl              int not null default 0,
  quiz            int not null default 0,
  validations     int not null default 0,
  bex_diff        int not null default 0,
  depassements    int not null default 0,
  bex_validations int not null default 0,
  missions        int not null default 0,
  exam_level      text,
  bex             jsonb not null default '[]',  -- [{index, label, attempts}]
  dl_dates        jsonb not null default '[]',  -- ["2026-09-07", …]
  quiz_dates      jsonb not null default '[]',
  import_id       bigint references suivi_imports(id) on delete set null,
  updated_at      timestamptz not null default now(),
  unique (student_id, course_id)
);

-- Un relevé par import : sert la courbe de progression et la détection de
-- stagnation. Volontairement plat et sans contrainte d'unicité.
create table if not exists suivi_history (
  id           bigserial primary key,
  student_id   uuid not null references students(id) on delete cascade,
  course_id    bigint not null references suivi_courses(id) on delete cascade,
  import_id    bigint references suivi_imports(id) on delete cascade,
  captured_at  timestamptz not null default now(),
  period       int,
  dl           int, quiz int, validations int, bex_diff int, depassements int,
  level        text
);

create index if not exists suivi_history_student_idx
  on suivi_history (student_id, course_id, captured_at);

-- ------------------------------------------------------- objectif et bulletins

-- L'objectif que l'élève se fixe, par période.
create table if not exists suivi_targets (
  id           bigserial primary key,
  student_id   uuid not null references students(id) on delete cascade,
  course_id    bigint not null references suivi_courses(id) on delete cascade,
  period       int not null check (period between 1 and 3),
  target_level text not null check (target_level in ('JS', 'S', 'B', 'TB')),
  chosen_at    timestamptz not null default now(),
  unique (student_id, course_id, period)
);

-- Bulletins figés au conseil de guidance (20/11, 19/3, 29/6). Une fois écrits,
-- les imports suivants ne les modifient plus.
create table if not exists suivi_snapshots (
  id           bigserial primary key,
  student_id   uuid not null references students(id) on delete cascade,
  course_id    bigint not null references suivi_courses(id) on delete cascade,
  period       int not null check (period between 1 and 3),
  frozen_at    timestamptz not null default now(),
  dl           int, quiz int, validations int, bex_diff int, depassements int,
  exam_level   text,
  level        text,
  target_level text,
  detail       jsonb not null default '{}',
  unique (student_id, course_id, period)
);

-- --------------------------------------------------------------- conseils

create table if not exists suivi_advice (
  key        text primary key,
  body       text not null,
  updated_at timestamptz not null default now()
);

insert into suivi_advice (key, body) values
  ('behind-dl',
   'Il te manque {X} devoirs libres. C''est le point le plus facile à rattraper, parce que ce n''est pas la justesse qui compte mais le fait d''avoir cherché. Rends le prochain même si tu n''es pas sûr de toi : un devoir tenté et faux compte autant qu''un devoir juste.'),
  ('behind-quiz',
   'Il te manque {X} quiz réussis. Les quiz portent sur ce que tu dois connaitre, pas sur des raisonnements à construire. C''est donc du travail de mémorisation : quinze minutes régulières valent mieux qu''une longue soirée la veille. Tes flashcards Leitner sont faites exactement pour ça.'),
  ('need-new-bex',
   'Il te manque {X} savoir-faire différents. Attention, ici repasser une BEX que tu maitrises déjà ne t''aidera pas : il faut en valider une nouvelle. Dans la liste ci-dessous, celles marquées d''un tiret n''ont jamais été validées. Choisis-en une, relis ses critères de réussite, refais deux exercices de la banque, et viens la passer.'),
  ('need-revalidation',
   'Tu as validé beaucoup de savoir-faire différents, c''est du bon travail. Ce qui te manque maintenant, ce sont des re-réussites : repasser une BEX déjà validée pour montrer que ce n''était pas un coup de chance. Reprends en priorité celles que tu n''as réussies qu''une seule fois, ce sont les plus rapides à consolider.'),
  ('need-depassement',
   'Il te manque {X} dépassement. Ce n''est pas du travail en plus pour t''occuper, c''est l''occasion de montrer autre chose : créer un QCM sur un chapitre, rédiger un corrigé, partager une ressource que tu as trouvée, poser une vraie question de recherche. Viens m''en parler, on choisit ensemble.'),
  ('exam-condition',
   'À partir de Bien, il faut aussi ne pas rater l''examen de juin, et pour Très bien y obtenir au moins Bien. L''examen reprend les savoir-faire des BEX : plus tu en auras validé plusieurs fois pendant l''année, moins tu auras à préparer en juin.'),
  ('many-behind',
   'Plusieurs choses sont en retard, alors ne t''éparpille pas. Commence par les devoirs libres, c''est le plus simple à rattraper et ça compte autant que le reste. Ensuite seulement, attaque les savoir-faire.'),
  ('missions-heavy',
   'Tu as accumulé pas mal de validations grâce aux missions, et c''est chouette de t''y investir. Mais les savoir-faire individuels restent la base : il te faut {X} validations de plus, et les BEX sont la voie la plus sûre.'),
  ('target-reached',
   'Tu as atteint ton objectif, bravo. Tu peux t''arrêter là et consolider ce que tu as, ou viser {next}. Pour y aller, il te faudrait : {ecart}.'),
  ('level-max',
   'Tu as atteint le niveau le plus haut. Il n''y a plus de palier au-dessus, mais tu peux continuer à te dépasser autrement : aider un camarade à valider une BEX, proposer un exercice de ton invention, ou explorer un sujet qui n''est pas au programme.'),
  ('period-start',
   'La période vient de commencer, c''est normal que tes compteurs soient encore bas. Choisis dès maintenant l''objectif que tu veux atteindre, ça t''aidera à savoir où mettre ton énergie.')
on conflict (key) do nothing;

-- ------------------------------------------------------------------- RLS
--
-- Les droits d'accès sont dans `policies.sql`, à exécuter juste après ce
-- fichier. Ils y sont seuls pour n'exister qu'en un seul endroit : deux copies
-- de policies finiraient par diverger, et c'est le genre d'écart qui rouvre un
-- accès en écriture sans qu'on s'en aperçoive.
--
-- En résumé : la clé anon publiée ne peut que LIRE ; seule `suivi_targets`
-- (l'objectif que l'élève choisit) accepte ses écritures ; l'import passe par la
-- clé `service_role` rangée dans `js/config.local.js`, jamais publiée.

alter table suivi_snapshots enable row level security;
drop policy if exists anon_all on suivi_snapshots;
create policy anon_all on suivi_snapshots for all to anon using (true) with check (true);

alter table suivi_advice enable row level security;
drop policy if exists anon_all on suivi_advice;
create policy anon_all on suivi_advice for all to anon using (true) with check (true);
