# Suivi de progression

Application web où chaque élève voit où il en est dans le cours, ce qui lui
manque pour atteindre la note qu'il vise, et comment s'y prendre.

Les données viennent du classeur « Feuilles de cotes », qui reste la source de
vérité : l'application ne fait que le lire, le mettre en forme et le comparer
aux seuils que la professeure y a fixés.

## Les cinq compteurs

| Compteur | Ce qu'il compte |
|---|---|
| **DL** | devoirs libres rendus |
| **Quiz** | validations de savoirs réussies |
| **Validations** | total des réussites, doublons compris (une BEX réussie, même déjà validée, ou un rôle de mission) |
| **BEX différentes** | savoir-faire distincts réussis au moins une fois |
| **Dépassements** | travaux facultatifs au-delà du programme |

Tout est cumulé depuis la rentrée. Le niveau atteint est le plus bas des
compteurs, avec un cran de tolérance sur les devoirs libres uniquement.
Les BEX socles sont exigées en fin d'année, et l'examen de juin conditionne les
deux niveaux les plus hauts.

Aucun dénominateur n'est jamais affiché à l'élève : un élève absent n'a pas pu
faire le travail, on ne compte donc que ce qui est acquis.

## Deux calendriers

Chaque période a une date de **dernier cours**, après laquelle une validation
compte pour la période suivante, et une date de **conseil de guidance**, où le
bulletin est figé et ne bouge plus.

## Mettre à jour les résultats

Double-clic sur **`Ouvrir l'administration.bat`**, puis le bouton **« Mettre à
jour maintenant »** : le serveur local lit le classeur là où il se trouve
(`WORKBOOK_PATH` dans `js/config.js`, un dossier OneDrive synchronisé) et envoie
tout vers l'application. Une dizaine de secondes, rien à retrouver dans
l'explorateur.

Il n'y a **pas d'heure fixe ni de tâche planifiée** : l'ordinateur n'a pas besoin
d'être allumé à un moment précis. Un import est rejouable autant de fois qu'on
veut, et un import qui ne change rien n'ajoute aucune étape à la progression des
élèves.

Le repli reste disponible : « Importer un autre fichier » pour un classeur qui
n'est pas à l'emplacement habituel, et `npm run import` en ligne de commande.

Le classeur est cherché dans cet ordre : le chemin donné en argument, puis
`WORKBOOK_PATH` s'il est exporté par `js/config.local.js` (propre à la machine),
puis celui de `js/config.js`, puis une recherche automatique dans OneDrive,
Téléchargements, Bureau et Documents — en gardant le fichier le plus récent.

## Installer sur un second ordinateur

Marche à suivre détaillée, écrite pour être lue depuis l'autre poste :
[MODE-D-EMPLOI-second-ordinateur.md](MODE-D-EMPLOI-second-ordinateur.md).
En résumé, l'administration peut tourner sur plusieurs postes — les imports sont
rejouables et se rapprochent par nom, deux ordinateurs ne peuvent donc pas se
contredire :

1. **Node.js** (version LTS) depuis [nodejs.org](https://nodejs.org) ;
2. **récupérer le projet** avec GitHub Desktop (dépôt `mysou87/suivi-eleves`) ;
3. **créer `js/config.local.js`** — il n'est jamais publié, il n'arrive donc pas
   avec le dépôt. Le plus sûr est de ne PAS transporter la clé (ni mail, ni clé
   USB) mais de la relire depuis le tableau de bord Supabase :
   Project Settings → API Keys → `service_role` → *Reveal*.

   ```js
   export const ADMIN_PASSWORD = 'le même mot de passe';
   export const SUPABASE_SERVICE_KEY = 'la clé service_role';
   // Facultatif : si le classeur est ailleurs sur cet ordinateur.
   // export const WORKBOOK_PATH = 'C:\\Users\\…\\Feuilles de cotes 2026-2027.xlsx';
   ```

4. **double-cliquer `Ouvrir l'administration.bat`** : il installe les
   dépendances au premier lancement, puis démarre.

**Sans OneDrive sur ce poste**, télécharge le classeur depuis Excel en ligne : il
sera trouvé tout seul dans « Téléchargements ». Attention alors à sa fraicheur —
l'import écrit des valeurs absolues, donc envoyer une copie ancienne ferait
redescendre des compteurs. L'administration compare la date du fichier à celle
du dernier import et **prévient avant** que tu cliques.

## Organisation du code

| Fichier | Rôle |
|---|---|
| `index.html`, `js/app.js` | écran élève |
| `admin.html`, `js/admin.js` | import, tableau de bord, conseils, figeage |
| `js/parser.js` | lecture du classeur, sans dépendre d'un numéro de ligne |
| `js/rules.js` | périodes, niveau atteint, écart vers l'objectif |
| `js/data.js` | lecture depuis Supabase |
| `js/sync.js` | écriture vers Supabase |
| `js/freeze.js` | bulletins figés |
| `sql/schema.sql` | schéma de la base |
| `tools/run-import.mjs` | lecture du classeur sur le disque + envoi, partagé par la ligne de commande et le bouton de l'admin |
| `tools/serve.mjs` | serveur local ; sert aussi `GET /api/workbook` et `POST /api/import`, refusés depuis un autre poste |
| `tools/` | import en ligne de commande, tests |

Le lecteur repère les blocs du classeur **par leur titre**, jamais par leur
position, et recalcule les colonnes des groupes de passages : les cellules
fusionnées du classeur se chevauchent d'une colonne, ce qui décalerait
silencieusement les résultats.

## Utilisation

```
npm install
npm run serve      # http://localhost:4173 (ajouter ?demo=1 pour des valeurs d'exemple)
npm run import     # importe le classeur vers Supabase
npm run status     # état de la base
npm test           # lecteur, règles, historique, validation sur données réelles
npm run test:data  # chaîne complète contre la vraie base
npm run check:policies  # qui a le droit d'écrire quoi
node tools/compare-live.mjs   # le classeur et la base disent-ils la même chose
node tools/clean-history.mjs  # états répétés dans l'historique (--apply pour supprimer)
```

## Confidentialité et droits d'accès

Le dépôt est public, mais :

- **la clé de base publiée ne sait que LIRE.** Les résultats, l'historique, les
  seuils, les bulletins figés et les textes de conseil ne s'écrivent qu'avec la
  clé `service_role`, rangée dans `js/config.local.js` et jamais publiée. Seule
  exception : `suivi_targets`, l'objectif que l'élève choisit lui-même. Tout est
  défini dans `sql/policies.sql`, et `npm run check:policies` le vérifie ;
- le **mot de passe de l'administration** vit dans le même fichier local. En
  ligne, le panneau d'administration est donc inaccessible : il ne sert que
  depuis l'ordinateur de la professeure ;
- le serveur local n'écoute **que sur `127.0.0.1`** : un autre poste du réseau ne
  peut pas lui demander `js/config.local.js` ;
- les **classeurs de cotes** sont exclus du dépôt, ils contiennent des noms et
  des résultats ;
- la connexion élève se fait par prénom, nom et classe, sans mot de passe. Un
  élève peut donc **lire** la progression d'un camarade dont il connait le nom,
  ce qui est un choix assumé — mais il ne peut rien modifier.

Reste ouvert, sciemment : la table `students` est **partagée avec l'app Leitner**,
dont l'administration tourne en ligne et y écrit avec la clé publique. Elle
accepte donc encore les écritures : on peut y ajouter ou renommer un élève, mais
aucun résultat n'en dépend. À reprendre le jour où Leitner passera aussi par une
clé privée.

Installation de la base, dans cet ordre : `sql/schema.sql` puis
`sql/policies.sql`, tous deux relançables sans risque.
