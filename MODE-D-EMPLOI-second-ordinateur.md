# Installer l'administration sur un second ordinateur

Ce document ne contient **aucun mot de passe ni aucune clé** : il est publié avec
le reste du projet, donc lisible par n'importe qui. Tu peux d'ailleurs l'ouvrir
directement depuis l'autre ordinateur, dans un navigateur :
[https://github.com/Mysou87/suivi-eleves/blob/main/MODE-D-EMPLOI-second-ordinateur.md](https://github.com/Mysou87/suivi-eleves/blob/main/MODE-D-EMPLOI-second-ordinateur.md)

Compte une vingtaine de minutes, la première fois seulement.

---

## Étape 0 — Publier la dernière version (depuis ton ordinateur principal)

⚠️ **À faire avant tout le reste.** Tant que les modifications ne sont pas
publiées, l'autre ordinateur téléchargerait une version périmée de
l'application, sans le bouton de mise à jour ni les nouveaux droits d'accès.

- [X] Ouvrir **GitHub Desktop** sur l'ordinateur principal
- [X] Vérifier que le dépôt affiché est bien `suivi-eleves`
- [X] En bas à gauche, écrire un résumé (par exemple `bouton de mise à jour et droits d'écriture`)
- [X] Cliquer **Commit to main**, puis **Push origin** en haut

Le fichier `js/config.local.js` n'est jamais envoyé : il est exclu du dépôt.
C'est voulu, et c'est pour ça qu'il faudra le recréer à la main à l'étape 3.

---

## Étape 1 — Installer Node.js

- [ ] Aller sur [https://nodejs.org](https://nodejs.org)
- [ ] Télécharger la version **LTS** (celle de gauche, marquée « recommandée »)
- [ ] Installer en laissant toutes les options par défaut
- [ ] Redémarrer l'ordinateur si l'installateur le demande

C'est le moteur qui fait tourner le petit serveur local. Rien ne s'affiche, il
travaille en coulisses.

---

## Étape 2 — Récupérer le projet

- [ ] Installer **GitHub Desktop** depuis [https://desktop.github.com](https://desktop.github.com)
- [ ] S'y connecter avec ton compte GitHub (le même que sur l'autre poste)
- [ ] **File → Clone repository**, choisir `Mysou87/suivi-eleves`
- [ ] Noter l'endroit où il l'enregistre (par défaut `Documents\GitHub\suivi-eleves`)

⚠️ Sur cet ordinateur, le dossier s'appellera **`suivi-eleves`** et non
`App-suivi-élèves` : c'est normal, c'est le nom du dépôt.

---

## Étape 3 — Créer le fichier de secrets

C'est la seule étape un peu technique, et la plus importante pour la sécurité.

- [ ] Dans le dossier `suivi-eleves`, ouvrir le sous-dossier `js`
- [ ] Créer un fichier texte nommé exactement **`config.local.js`**

  > Astuce : clic droit → Nouveau → Document texte, puis renomme-le
  > `config.local.js`. Si Windows cache les extensions, tu risques d'obtenir
  > `config.local.js.txt`, qui ne fonctionnerait pas. Pour vérifier : dans
  > l'Explorateur, onglet **Affichage** → cocher **Extensions de noms de
  > fichiers**.
  >
- [ ] L'ouvrir avec le Bloc-notes et y coller ceci :

```js
export const ADMIN_PASSWORD = 'ton mot de passe habituel';
export const SUPABASE_SERVICE_KEY = 'la clé récupérée juste en dessous';
```

- [ ] Remplacer `ton mot de passe habituel` par celui que tu utilises déjà pour
  entrer dans l'administration. Je ne l'écris pas ici, puisque ce document
  est public.

### Récupérer la clé d'écriture

**Ne transporte pas la clé** par mail, par clé USB ou par capture d'écran : va la
relire à la source, c'est aussi rapide et rien ne circule.

- [ ] Ouvrir [https://supabase.com/dashboard](https://supabase.com/dashboard) et se connecter
- [ ] Choisir le projet **iuharjafrhwzhhggwzgy**
- [ ] Menu **Project Settings** (la roue dentée, en bas à gauche) → **API Keys**
- [ ] Ligne **`service_role`** → bouton **Reveal** → copier la longue suite de caractères
- [ ] La coller entre les apostrophes, à la place de `la clé récupérée juste en dessous`
- [ ] Enregistrer le fichier

À quoi sert cette clé : la clé publique de l'application ne sait que **lire** la
base. Sans cette clé privée, l'administration s'ouvrirait mais ne pourrait rien
enregistrer.

⚠️ Cette clé contourne toutes les protections de la base. Elle ne doit jamais
sortir de cet ordinateur. Le dossier `js` est configuré pour ne jamais l'envoyer
sur GitHub, tu n'as donc rien à surveiller de ce côté.

---

## Étape 4 — Premier lancement

- [ ] Dans le dossier `suivi-eleves`, double-cliquer **`Ouvrir l'administration.bat`**
- [ ] Au tout premier lancement, il installe ce qu'il lui manque : laisse-le
  faire, ça prend une minute et n'arrivera qu'une fois
- [ ] Le navigateur s'ouvre sur la page d'administration
- [ ] Saisir le mot de passe

Une fenêtre noire reste ouverte pendant que tu travailles : c'est le serveur.
Ferme-la quand tu as fini.

Si le fichier `.bat` te dit qu'il manque quelque chose, il te dit aussi quoi
faire. Les cas possibles sont dans le tableau plus bas.

---

## Étape 5 — Vérifier que tout est en ordre

- [ ] En haut de la page d'administration, **aucun bandeau rouge** ne doit
  apparaitre. S'il est écrit « Lecture seule », la clé de l'étape 3 est
  absente ou mal collée.
- [ ] Onglet **Tableau de bord** : tes élèves s'affichent, avec leurs classes.
- [ ] Onglet **Importer** : soit le classeur est trouvé, soit il est annoncé
  introuvable, ce qui est normal sur ce poste (voir juste en dessous).

Contrôle complet, facultatif : ouvrir un terminal dans le dossier
(clic droit dans le dossier → **Ouvrir dans le terminal**) et taper :

```
npm run check:policies
```

La dernière ligne doit dire : *Droits corrects : lecture pour tous, écriture
pour toi seule.*

---

## Utiliser l'application sur cet ordinateur

Comme OneDrive n'y est pas installé, le classeur n'existe pas sur ce poste. Il
faut donc en récupérer une copie avant chaque mise à jour :

1. Ouvrir le classeur dans **Excel en ligne** et le télécharger
   (*Fichier → Télécharger une copie*). Il arrive dans « Téléchargements ».
2. Double-cliquer `Ouvrir l'administration.bat`, saisir le mot de passe.
3. Onglet **Importer** : le classeur téléchargé est trouvé tout seul. Vérifie
   la ligne qui indique **quand il a été enregistré** et **son emplacement**.
4. Cliquer **Mettre à jour maintenant**. Une dizaine de secondes.

### Le point de vigilance, à lire une fois

L'import enregistre des **valeurs absolues**, pas des ajouts : il recopie l'état
du classeur qu'on lui donne. Envoyer une copie ancienne ferait donc
**redescendre** les compteurs des élèves.

L'application te protège de deux façons : elle affiche la date d'enregistrement
du fichier qu'elle a trouvé, et elle **prévient en rouge** si ce fichier est plus
ancien que celui importé la dernière fois. Si tu vois cet avertissement,
retélécharge le classeur avant de continuer.

Le réflexe simple : **télécharger le classeur juste avant d'importer**, jamais
travailler sur un téléchargement de la semaine dernière.

Rien n'empêche par ailleurs d'utiliser les deux ordinateurs : un import peut être
rejoué autant de fois qu'on veut, les élèves sont rapprochés par leur nom, et un
import qui ne change rien n'ajoute aucune étape à leur progression.

---

## Si ça coince

| Ce que tu vois                                                                 | Ce qui se passe                                                                                    | Quoi faire                                                                 |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `node n'est pas reconnu` ou le `.bat` réclame Node                        | Node.js n'est pas installé, ou l'ordinateur n'a pas été redémarré depuis                      | Refaire l'étape 1, puis redémarrer                                       |
| Le`.bat` réclame `js/config.local.js`                                     | Le fichier manque, ou s'appelle`config.local.js.txt`                                             | Refaire l'étape 3 en affichant les extensions                             |
| « Mot de passe incorrect »                                                   | Ce n'est pas le bon, ou une espace s'est glissée avant ou après entre les apostrophes            | Rouvrir`config.local.js` et vérifier                                    |
| « L'administration ne fonctionne que depuis l'ordinateur de la professeure » | Tu as ouvert la version**en ligne** de l'administration, qui est volontairement inutilisable | Passer par le`.bat`, adresse `localhost:4173/admin.html`               |
| Bandeau rouge « Lecture seule »                                              | La clé`service_role` manque ou est incomplète                                                  | Refaire la fin de l'étape 3, en recopiant la clé entière                |
| « Classeur introuvable »                                                     | Normal sur ce poste tant que rien n'est téléchargé                                              | Télécharger le classeur, puis recharger la page                          |
| Le mauvais classeur est proposé                                               | Plusieurs fichiers « Feuilles de cotes » traînent sur l'ordinateur                              | Supprimer les vieilles copies, ou utiliser « Importer un autre fichier » |
| Avertissement rouge sur la date du fichier                                     | Le fichier trouvé est plus ancien que le dernier import                                           | Retélécharger le classeur avant d'importer                               |
| La page ne s'ouvre pas du tout                                                 | Le serveur n'a pas démarré, ou le port est occupé                                               | Fermer la fenêtre noire, relancer le`.bat`                              |

---

## Aide-mémoire

À taper dans un terminal ouvert dans le dossier du projet, si besoin un jour :

```
npm run check:policies        # qui a le droit d'écrire quoi
npm run status                # ce que contient la base
npm run import                # mise à jour sans passer par la page web
node tools/compare-live.mjs   # le classeur et la base disent-ils la même chose
```

Et pour récupérer, sur ce poste, les modifications faites depuis l'autre
ordinateur : ouvrir **GitHub Desktop** et cliquer **Pull origin**.
