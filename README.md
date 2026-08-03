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
| `tools/` | import en ligne de commande, serveur local, tests |

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
```

## Confidentialité

Le dépôt est public, mais :

- le **mot de passe de l'administration** vit dans `js/config.local.js`, qui
  n'est jamais publié. En ligne, le panneau d'administration est donc
  inaccessible : il ne sert que depuis l'ordinateur de la professeure ;
- les **classeurs de cotes** sont exclus du dépôt, ils contiennent des noms et
  des résultats ;
- la connexion élève se fait par prénom, nom et classe, sans mot de passe. Un
  élève peut donc voir la progression d'un camarade dont il connait le nom, ce
  qui est un choix assumé.
