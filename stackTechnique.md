# Bibliothèque Numérique — Résumé technique pour reprise de projet

## Stack technique

- **Astro 5** — générateur de site statique, `output: 'static'`, déploiement GitHub Pages
- **React 18** + **`@astrojs/react` 4** — composants interactifs côté client ("îlots")
- **Clover IIIF** (`@samvera/clover-iiif`) — viewer IIIF multicanvas
- **Pagefind** — index plein texte généré au build, chargé par fragments dans le navigateur
- **fast-xml-parser** — parsing XML au moment du build (`preserveOrder: true`)
- **Python** (scripts externes) — preprocessing des données

---

## Structure des dossiers

```
projet/
├── astro.config.mjs
├── package.json
├── tsconfig.json                      # jsx: react-jsx, jsxImportSource: react
│
├── data/                              # DÉPÔT SÉPARÉ (données, géré par les utilisateurs)
│   ├── metadata.csv                   # une ligne par livre, colonnes libres
│   ├── manifestes/                    # manifestes IIIF générés par le script Python
│   │   └── 10.34847-nkl.5be8vpp2.json
│   ├── transcriptions/
│   │   └── Livre-01.xml
│   └── scripts/
│       ├── pdf_vers_images.py         # PDF → JPEG (pour dépôt sur Nakala)
│       └── nakala_vers_manifeste.py   # API Nakala → manifestes IIIF v3
│
├── public/
│   └── manifestes/                    # copié depuis data/manifestes/ au build
│
└── src/
    ├── layouts/
    │   └── Base.astro                 # layout commun : nav + footer + CSS global
    ├── lib/
    │   ├── parseData.ts               # lecture CSV + XML au build, détection des facettes
    │   └── xmlRules.ts                # règles de conversion XML → HTML (schémas déclarés ici)
    ├── pages/
    │   ├── index.astro                # accueil : hero + grille de livres
    │   ├── recherche.astro            # passe les données à MoteurFacettes
    │   └── livres/
    │       └── [id].astro             # page livre : modes onglets / côte-à-côte
    └── components/
        ├── CarteLivre.astro           # carte d'un livre dans la grille
        ├── CloverViewer.jsx           # îlot React — viewer IIIF (client:only)
        └── MoteurFacettes.jsx         # îlot React — recherche + filtres (client:load)
```

---

## Flux de données

### 1. Preprocessing (scripts Python, lancés manuellement)

```
pdfs/*.pdf
    └─ pdf_vers_images.py ──→ data/images/[id]/page-001.jpg ...
                                    │
                                    ▼ (dépôt manuel sur Nakala)
                              Nakala (hébergement IIIF)
                                    │
                                    ▼
nakala_vers_manifeste.py ──→ data/manifestes/[id].json
    (appelle API Nakala :          (manifeste IIIF v3 avec dimensions
     /collections/[id]/datas        récupérées via info.json)
     + /iiif/[id]/[sha1]/info.json)
```

### 2. Build Astro (`npm run build`)

```
data/metadata.csv ──┐
                    ├─→ parseData.ts ──→ getLivres() ──→ pages statiques
data/transcriptions/│   + xmlRules.ts    getColonnesMeta()   (/livres/[id])
    *.xml ──────────┘                   getLivreAvecTranscription()
                                              └─→ TranscriptionPage[]
                                                    ├─ html
                                                    └─ ancres[] (id, label, pageN, inPassages)
                                        getTextePages()  (texte brut, césures recollées)
                                              └─→ indexRecherche.ts + normalisation.js
data/equivalences.tsv ─────────────────────────┘   └─→ dist/pagefind/  (un enregistrement par page)

data/manifestes/ ──→ cp → public/manifestes/ ──→ servis statiquement
```

### 3. Runtime (navigateur)

```
/recherche
    └─→ MoteurFacettes.jsx (React, client:load)
            ├─ facettes + titre/auteur/sous-titre : filtrés dans le navigateur
            └─ plein texte : Pagefind (fragments chargés à la demande), voir ci-dessous

/livres/[id]
    └─→ CloverViewer.jsx (React, client:only)
            └─ charge public/manifestes/[id].json
               → Clover IIIF → OpenSeadragon → images Nakala (IIIF Image API v3)
```

---

## Moteur de recherche plein texte (Pagefind)

### Indexation au build

L'intégration `rechercheIndex()` d'`astro.config.mjs` appelle `construireIndexRecherche()` (`src/lib/indexRecherche.ts`) après le build, et écrit l'index dans `dist/pagefind/`. En dev, l'index est construit au démarrage dans `.astro/pagefind/` et servi par un middleware sous `<base>/pagefind/`.

Un enregistrement Pagefind par page de transcription :

- `content` : texte normalisé, le seul indexé ;
- `meta` : `livre` (id nakala), `page` (index de la page = canvas IIIF), `n` (`@n` du XML), `texte` (texte original, pour les extraits) ;
- `filters.livre` : pour restreindre une recherche à certains livres.

Le texte vient de `getTextePages()` (`parseData.ts`) : il est extrait de l'arbre XML (balises `ignore` exclues, pas de « # » d'ancre) et les mots coupés en fin de ligne sont recollés (« ren- / contre » → « rencontre »).

### Normalisation et équivalences

`src/lib/normalisation.js` est partagé par le build et le navigateur : texte et requête subissent exactement la même transformation.

1. minuscules, apostrophes typographiques → `'` ;
2. équivalences de `data/equivalences.tsv` (une ligne = des formes équivalentes séparées par des tabulations). Les lignes qui partagent une forme sont fusionnées. Chaque classe est ramenée à sa première forme en lettres simples (`ã an am` → `an`) : d'abord les équivalences d'un caractère (i/j, u/v, ſ/s), puis les autres par plus longue correspondance ;
3. diacritiques retirés ;
4. `m` → `n` après une voyelle ou une nasale. Les lignes nasales se chevauchent (`om` et `mm` dans « comme »), et cette règle les résout sans dépendre du découpage. « mon » et « non » restent distincts.

La table est modifiable sans toucher au code. Un nouveau build régénère l'index.

### Recherche dans le navigateur

- `/recherche` (`MoteurFacettes.jsx`) : facettes et métadonnées filtrées localement, puis recherche Pagefind restreinte aux livres retenus. Le nombre de pages trouvées par livre vient des comptes de filtre de Pagefind. Les cartes s'affichent par tranches de 20, et chacune charge ses 3 meilleurs passages (`ExtraitsLivre.jsx`).
- Page livre (`RechercheLivre.jsx`) : même index, filtré sur le livre ; un clic émet `transcription:goto`.
- Correspondance par préfixe et racinisation française (Pagefind) ; phrase exacte entre guillemets ; pas de recherche floue.
- `rechercher()` (`src/lib/pagefind.js`) écarte le repli de Pagefind sur le plus long préfixe d'un mot absent (« zzzzqx » trouverait « z »).

### Extraits

Pagefind renvoie les positions des mots trouvés dans `content`. `construireExtrait()` les ramène aux mots de `meta.texte` en refaisant le découpage de l'indexation (chaque mot original donne zéro, un ou plusieurs mots normalisés), puis affiche la fenêtre de 32 mots qui contient le plus d'occurrences.

---

## Conventions des données

### metadata.csv — colonnes

| Colonne | Statut | Rôle |
|---|---|---|
| `id` | **obligatoire** | identifiant Nakala (`nkl.xxxx`), doit correspondre au nom du XML et du manifeste ; l'URL `/livres/[slug]` est générée depuis le titre |
| `titre` | **obligatoire** | affiché en titre |
| `auteur` | **obligatoire** | plusieurs auteurs séparés par `;` |
| `manifeste_url` | **obligatoire** | URL du manifeste IIIF servi par le site, peut être une url distante écrite en dure ou une url relative |
| `sous_titre` | optionnel | affiché en italique |
| toute autre colonne | libre | devient automatiquement une facette |

**Forcer le type d'une facette** en préfixant le nom de colonne : `range__date`, `select__genre`, `text__remarques`

---

### XML transcriptions — architecture générale

Le parsing XML est découpé en deux fichiers aux responsabilités séparées :

- **`xmlRules.ts`** — déclare les schémas et leurs règles de conversion. C'est le seul fichier à modifier pour adapter le rendu HTML ou ajouter un nouveau format XML.
- **`parseData.ts`** — moteur générique qui lit les règles, détecte le schéma, et produit le HTML + les ancres. Ne pas modifier sauf pour changer la logique de traversée.

---

## Page livre (`[id].astro`) — architecture détaillée

### Modes d'affichage

La page propose deux modes commutables via une barre en haut :

- **Côte-à-côte** (défaut) — viewer IIIF et transcription affichés simultanément en deux colonnes
- **Onglets** — viewer / transcription / passages affichés en onglets dans une seule colonne

Le mode choisi est persisté dans `sessionStorage` (`livreMode`). Le mode côte-à-côte est le défaut. Si l'URL contient un hash (`#ancre-id` ou `#page-<index>`), le mode côte-à-côte est toujours forcé, quelle que soit la préférence sauvegardée.

### Navigation de transcription

La navigation entre pages de transcription utilise :
- Un **select** "Page N" en haut du panneau
- Des boutons **Précédent / Suivant** en haut et en bas du contenu

Le conteneur de transcription a une hauteur fixe (`70vh`) en mode côte-à-côte, identique à celle du viewer. La zone de texte scroll en interne (`overflow-y: auto`), les barres de navigation haut et bas sont toujours visibles hors du scroll (`flex-shrink: 0`). En mode onglets, la hauteur est libre.

### État de page unique

La transcription est rendue une seule fois (`#transcription`). Comme le viewer, `setMode()` la déplace entre `#transcription-slot-onglets` et `#transcription-slot-cote`. Les ids d'ancre sont donc uniques, et un seul objet `etat = { page: 0 }` suffit : basculer de mode ne change pas la page courante. Une ancre `#page-<index>` (liens des résultats de recherche) ouvre la page correspondante en côte-à-côte.

### Viewer IIIF — CloverViewer.jsx

`CloverViewer` est un composant React monté avec `client:only="react"` (jamais exécuté côté serveur, ce qui évite `document is not defined` dû à OpenSeadragon). Le composant Clover est lui-même importé dynamiquement dans un `useEffect` pour la même raison.

#### Synchronisation bidirectionnelle viewer ↔ transcription

La communication passe par des **CustomEvents** sur `window` :

| Événement | Direction | Payload |
|---|---|---|
| `clover:goto` | transcription → viewer | `{ detail: { index: number } }` |
| `clover:pagechange` | viewer → transcription | `{ detail: { index: number } }` |
| `clover:sync-enabled` | `[id].astro` → viewer | aucun |
| `clover:sync-disabled` | `[id].astro` → viewer | aucun |

**Viewer → transcription** : via la prop officielle `canvasIdCallback` de Clover. Le composant convertit l'id IIIF du canvas actif en index via `canvasIdsRef` et émet `clover:pagechange`.

**Transcription → viewer** : via un plugin invisible (`SyncPlugin`) enregistré dans `plugins[].imageViewer.controls`. Le plugin écoute `clover:goto` et dispatche `{ type: 'updateActiveCanvas', canvasId }` dans le contexte React de Clover.

**Anti-boucle** : `ignoreNextRef` est positionné à `true` avant chaque navigation programmatique. Le `canvasIdCallback` qui s'ensuit est ignoré.

### Navigation vers un passage (ancres)

Tout élément marqué `anchorable: true` dans `xmlRules.ts` reçoit un `id` HTML unique au build. Les URLs directes (`/livres/Livre-01#blockquotation-12`) sont gérées par `gererAncreUrl()` au chargement.

---

## Points d'attention pour la reprise

### Viewer Clover — diagnostic

Si la synchro transcription → viewer ne fonctionne pas, vérifier dans la console :
1. Que `clover:goto` est bien émis
2. Que `canvasIdsRef.current` n'est pas vide (le fetch du manifeste a réussi)
3. Que `SyncPlugin` est bien monté

### Import dynamique obligatoire

`CloverViewer.jsx` importe Clover via `import('@samvera/clover-iiif/viewer')` dans un `useEffect`, jamais en import statique. Sans ça, le build Astro échoue avec `document is not defined`.

### Correspondance canvas IIIF ↔ page XML

La synchro suppose que le canvas n°i du manifeste correspond à la page n°i du XML. Un décalage (ex. canvas de couverture supplémentaire) briserait la synchro.

### Gestion des URL

Ce site supporte le fait d'avoir un prefixe d'url dans l'url, ce dernier est défini dans le fichier de config astro.config.mjs, pour être sûr que tous les liens sont bons, on utilise le helper url dans lib/url pour construire des liens en mettant automatiquement le préfixe devant. Cela vaut aussi pour les liens vers les manifestes relatifs indiqués dans le csv.

AU DEPLOIEMENT, on effectue un sed avant le build pour remplacer toutes les urls par une url de déploiement indiquée dans le fichier .github/workflows/deploy.yaml