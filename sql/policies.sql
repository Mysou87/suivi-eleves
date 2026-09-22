-- Droits d'accès (RLS) — à exécuter dans l'éditeur SQL de Supabase.
--
-- Ce fichier est RELANÇABLE autant de fois qu'on veut : il ne touche aucune
-- donnée, il ne fait que redéfinir qui a le droit de quoi.
--
-- ------------------------------------------------------------------ le principe
--
-- La clé « anon » est publiée dans un dépôt public : il faut donc considérer que
-- n'importe qui l'a. Elle ne doit plus permettre que la LECTURE.
--
-- Seule exception : `suivi_targets`, l'objectif que l'élève choisit lui-même
-- (Juste suffisant / Suffisant / Bien / Très bien). C'est la seule chose qu'un
-- élève écrit, et le pire qu'un plaisantin puisse y faire est de changer
-- l'objectif affiché de quelqu'un — aucun résultat n'en dépend.
--
-- Tout le reste (compteurs, historique, seuils, bulletins figés, conseils) n'est
-- écrit que par l'import, qui utilise désormais la clé `service_role` rangée
-- dans `js/config.local.js`, jamais publiée. Cette clé contourne RLS par nature.
--
-- ------------------------------------------------- ce qui n'est PAS touché ici
--
-- La table `students` est PARTAGÉE avec l'app Leitner, dont le panneau
-- d'administration tourne en ligne et y écrit (ajout d'élève, import CSV,
-- rentrée scolaire) avec la même clé anon. La verrouiller casserait Leitner.
-- Elle reste donc accessible en écriture : quelqu'un qui trouve la clé peut
-- ajouter ou renommer un élève, mais pas toucher à un seul résultat.
-- À reprendre le jour où Leitner passera aussi par une clé d'écriture privée.

-- --------------------------------------------------------- lecture seule (anon)

-- Les `drop policy if exists` retirent l'ancienne policy « anon_all », qui
-- autorisait tout. On les nomme explicitement plutôt qu'en boucle, pour que
-- l'analyseur de sécurité de Supabase voie bien RLS actif sur chaque table.

alter table suivi_courses enable row level security;
drop policy if exists anon_all on suivi_courses;
drop policy if exists anon_read on suivi_courses;
create policy anon_read on suivi_courses for select to anon using (true);

alter table suivi_course_aliases enable row level security;
drop policy if exists anon_all on suivi_course_aliases;
drop policy if exists anon_read on suivi_course_aliases;
create policy anon_read on suivi_course_aliases for select to anon using (true);

alter table suivi_items enable row level security;
drop policy if exists anon_all on suivi_items;
drop policy if exists anon_read on suivi_items;
create policy anon_read on suivi_items for select to anon using (true);

alter table suivi_thresholds enable row level security;
drop policy if exists anon_all on suivi_thresholds;
drop policy if exists anon_read on suivi_thresholds;
create policy anon_read on suivi_thresholds for select to anon using (true);

alter table suivi_socle enable row level security;
drop policy if exists anon_all on suivi_socle;
drop policy if exists anon_read on suivi_socle;
create policy anon_read on suivi_socle for select to anon using (true);

alter table suivi_imports enable row level security;
drop policy if exists anon_all on suivi_imports;
drop policy if exists anon_read on suivi_imports;
create policy anon_read on suivi_imports for select to anon using (true);

alter table suivi_enrollments enable row level security;
drop policy if exists anon_all on suivi_enrollments;
drop policy if exists anon_read on suivi_enrollments;
create policy anon_read on suivi_enrollments for select to anon using (true);

alter table suivi_counters enable row level security;
drop policy if exists anon_all on suivi_counters;
drop policy if exists anon_read on suivi_counters;
create policy anon_read on suivi_counters for select to anon using (true);

alter table suivi_history enable row level security;
drop policy if exists anon_all on suivi_history;
drop policy if exists anon_read on suivi_history;
create policy anon_read on suivi_history for select to anon using (true);

-- Ces deux tables n'avaient jamais eu RLS activé du tout : elles étaient donc
-- encore plus ouvertes que les autres. Un visiteur pouvait réécrire les textes
-- de conseil lus par les élèves, ou inventer des bulletins figés.

alter table suivi_advice enable row level security;
drop policy if exists anon_all on suivi_advice;
drop policy if exists anon_read on suivi_advice;
create policy anon_read on suivi_advice for select to anon using (true);

alter table suivi_snapshots enable row level security;
drop policy if exists anon_all on suivi_snapshots;
drop policy if exists anon_read on suivi_snapshots;
create policy anon_read on suivi_snapshots for select to anon using (true);

-- ---------------------------------------- seule écriture permise : je me connecte

-- L'élève écrit la date à chaque connexion (upsert) : une policy INSERT et
-- une policy UPDATE, comme pour l'objectif.
--
-- ⚠️ Une policy SELECT est nécessaire aussi, même si l'admin (clé service_role,
-- hors RLS) est seule censée lire cette table : PostgreSQL doit pouvoir « voir »
-- la ligne existante pour savoir si l'upsert doit insérer ou mettre à jour
-- (chemin ON CONFLICT DO UPDATE). Sans elle, l'upsert échoue dès la 2e
-- connexion avec « new row violates row-level security policy ». Sans risque
-- réel : une date de connexion n'a rien de sensible, et toutes les autres
-- tables de l'app sont de toute façon déjà lisibles par la clé anon.

alter table suivi_logins enable row level security;
drop policy if exists anon_mark_seen on suivi_logins;
drop policy if exists anon_update_seen on suivi_logins;
drop policy if exists anon_read on suivi_logins;

create policy anon_read on suivi_logins for select to anon using (true);
create policy anon_mark_seen on suivi_logins for insert to anon with check (true);
create policy anon_update_seen on suivi_logins for update to anon using (true) with check (true);

-- ------------------------------------- seule écriture permise : l'objectif visé

-- L'élève enregistre son objectif avec un `upsert` : PostgreSQL exige alors
-- une policy INSERT *et* une policy UPDATE (le chemin « ON CONFLICT DO UPDATE »).
-- Pas de policy DELETE : personne ne peut supprimer l'objectif d'un autre.

alter table suivi_targets enable row level security;
drop policy if exists anon_all on suivi_targets;
drop policy if exists anon_read on suivi_targets;
drop policy if exists anon_choose_target on suivi_targets;
drop policy if exists anon_change_target on suivi_targets;

create policy anon_read on suivi_targets for select to anon using (true);
create policy anon_choose_target on suivi_targets for insert to anon with check (true);
create policy anon_change_target on suivi_targets for update to anon using (true) with check (true);

-- ------------------------------------------------------------- vérification
--
-- À exécuter pour contrôler le résultat : chaque table `suivi_*` doit avoir
-- RLS actif et la seule commande « SELECT », sauf `suivi_targets` et
-- `suivi_logins` qui ont en plus INSERT et UPDATE.

select c.relname                                  as table,
       c.relrowsecurity                           as rls_actif,
       coalesce(string_agg(p.cmd, ', ' order by p.cmd), 'AUCUNE POLICY') as commandes
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p on p.schemaname = n.nspname and p.tablename = c.relname
where n.nspname = 'public' and c.relname like 'suivi/_%' escape '/'
group by c.relname, c.relrowsecurity
order by c.relname;
