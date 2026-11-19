/**
 * normalisation.js — normalisation du texte pour la recherche plein texte.
 *
 * Partagé entre le build (indexation Pagefind, voir indexRecherche.ts) et le
 * navigateur (requêtes) : les deux côtés doivent appliquer exactement la même
 * transformation, sinon une requête ne retrouve pas le texte indexé.
 *
 * Les équivalences viennent de data/equivalences.tsv : chaque ligne liste des
 * formes équivalentes séparées par des tabulations (ex. « ã	an	am »). Chaque
 * classe d'équivalence est ramenée à une forme canonique, dans le texte comme
 * dans la requête.
 *
 * IMPORTANT : ne rien importer de node:* ici (module chargé dans le navigateur).
 */

const APOSTROPHES = /[’ʼ‘]/g

const minusculesNfc = s => s.normalize('NFC').toLowerCase().replace(APOSTROPHES, "'")
const replierDiacritiques = s => s.normalize('NFD').replace(/\p{M}/gu, '')
const echapperRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Compile le TSV en règles sérialisables (passées en props aux îles React).
 * Retourne { caracteres, sequences } :
 *   caracteres : équivalences d'un caractère à un caractère (i/j, u/v, ſ/s),
 *                appliquées en premier ;
 *   sequences  : toutes les autres formes → forme canonique, remplacées par
 *                plus longue correspondance.
 */
export function compilerEquivalences(tsv) {
  // Union-find : deux lignes qui partagent une forme forment une seule classe
  // (« u	v » et « v	u », « ã	an	am » et « ā	an	am »).
  const parent = new Map()
  const racine = f => { while (parent.get(f) !== f) f = parent.get(f); return f }
  for (const ligne of tsv.split(/\r?\n/)) {
    const formes = [...new Set(ligne.split('\t').map(f => minusculesNfc(f.trim())).filter(Boolean))]
    if (formes.length < 2) continue
    for (const f of formes) if (!parent.has(f)) parent.set(f, f)
    for (const f of formes.slice(1)) parent.set(racine(f), racine(formes[0]))
  }

  const classes = new Map()
  for (const f of parent.keys()) {
    const r = racine(f)
    if (!classes.has(r)) classes.set(r, [])
    classes.get(r).push(f)
  }

  // Forme canonique : la première forme en lettres simples (« an » pour ã/an/am),
  // à défaut la première forme sans ponctuation, diacritiques retirés (« e » pour E'/É).
  const canonique = formes =>
    formes.find(f => /^[a-z]+$/.test(f))
    ?? replierDiacritiques(formes.find(f => /^[\p{L}\p{N}]+$/u.test(replierDiacritiques(f))) ?? formes[0])
      .replace(/[^\p{L}\p{N}]/gu, '')

  const caracteres = {}
  const sequences = {}
  for (const formes of classes.values()) {
    const cible = canonique(formes)
    const unCaractere = [...formes, cible].every(f => [...f].length === 1)
    for (const f of formes) {
      if (unCaractere) { if (f !== cible) caracteres[f] = cible }
      // La forme canonique est gardée (identité) pour que le découpage par plus
      // longue correspondance la traite comme une unité.
      else sequences[f] = cible
    }
  }
  return { caracteres, sequences }
}

/**
 * Crée les fonctions de normalisation à partir des règles compilées.
 *   normaliserTexte(texte)  → texte normalisé (minuscules, équivalences, sans diacritiques)
 *   motsNormalises(texte)   → mots normalisés, dans l'ordre
 *   normaliserRequete(req)  → requête prête pour Pagefind (guillemets conservés)
 */
export function creerNormaliseur({ caracteres = {}, sequences = {} } = {}) {
  const reCaracteres = Object.keys(caracteres).length
    ? new RegExp(`[${Object.keys(caracteres).map(echapperRegex).join('')}]`, 'gu')
    : null
  const phase1 = s => reCaracteres ? s.replace(reCaracteres, c => caracteres[c]) : s

  // Les formes de la phase 2 passent elles-mêmes par la phase 1 (« qui » reste
  // « qui », mais une forme contenant j ou v doit devenir i ou u).
  const table = new Map()
  for (const [forme, cible] of Object.entries(sequences)) table.set(phase1(forme), phase1(cible))
  // Alternance triée par longueur décroissante = plus longue correspondance.
  // (?!\p{M}) : ne pas couper une lettre de son diacritique combinant (« om » dans « om̃ »).
  const formes = [...table.keys()].sort((a, b) => b.length - a.length)
  const reSequences = formes.length
    ? new RegExp(`(?:${formes.map(echapperRegex).join('|')})(?!\\p{M})`, 'gu')
    : null

  const normaliserTexte = texte => {
    let s = phase1(minusculesNfc(texte))
    if (reSequences) s = s.replace(reSequences, m => table.get(m))
    // Les lignes nasales de la table (ã/an/am, m̃/mn/mm, ñ/nn/nm…) se chevauchent :
    // « com̃e » et « comme » seraient découpés différemment (« om » avale le
    // premier m). Elles reviennent toutes à « m vaut n après une voyelle ou une
    // nasale » : appliqué en dernier, c'est indépendant du découpage. « mon »
    // et « non » restent distincts.
    return replierDiacritiques(s).replace(/(?<=[aeiouy]|[mn])m/g, 'n')
  }

  const motsNormalises = texte => normaliserTexte(texte).split(/[^\p{L}\p{N}]+/u).filter(Boolean)

  const vides = new Set(MOTS_VIDES.flatMap(motsNormalises))
  const estIndexe = mot => !vides.has(mot)
  // Mots tels qu'indexés par Pagefind : normalisés, sans les mots vides.
  const motsIndexes = texte => motsNormalises(texte).filter(estIndexe)

  // Les segments entre guillemets restent des phrases exactes pour Pagefind.
  // Les mots vides sont retirés aussi des phrases : absents de l'index, leurs
  // voisins y sont adjacents (« homme de bien » est indexé « homme bien »).
  const normaliserRequete = requete =>
    requete.split('"')
      .map((segment, i) => {
        const mots = segment.split(/\s+/).flatMap(motsIndexes).join(' ')
        return i % 2 === 1 && mots ? `"${mots}"` : mots
      })
      .filter(Boolean)
      .join(' ')

  /** Mots vides de la saisie, tels que tapés, ignorés par la recherche plein texte (« l'homme » → « l »). */
  const motsIgnores = requete => [...new Set(
    requete.split(/[^\p{L}\p{N}&]+/u).filter(m => m && motsNormalises(m).some(n => vides.has(n)))
  )]

  return { normaliserTexte, motsNormalises, motsIndexes, normaliserRequete, motsIgnores }
}

/**
 * Un mot trouvé par Pagefind correspond-il vraiment au terme cherché (tous deux
 * normalisés) ? Pagefind rapproche les mots par racine (« heureuse » → « heureux »)
 * mais se rabat aussi, pour un mot absent de l'index, sur son plus long préfixe
 * présent (« zzzzqx » → « z »). On exige au moins 60 % des lettres initiales du
 * terme en commun, et 3 au minimum.
 */
export function correspondAuTerme(terme, mot) {
  let i = 0
  while (i < terme.length && terme[i] === mot[i]) i++
  return i >= Math.min(terme.length, Math.max(3, Math.ceil(terme.length * 0.6)))
}

/**
 * Langue déclarée à Pagefind, à l'indexation comme à la recherche. Volontairement
 * pas « fr » : le stemmer français réduit les mots à une racine courte puis
 * Pagefind cherche tous les mots qui commencent par cette racine (« neri » → « ner »
 * → neron, nerf… ; « honne » → « hon » → honte, honneur). Sur un gros corpus, ce
 * bruit noyait les vrais résultats. Sans stemmer, seul reste l'élargissement par
 * préfixe du mot entier (« loup » trouve « loups »).
 */
export const LANGUE_INDEX = 'zz'

/** Termes d'une requête normalisée (normaliserRequete), guillemets retirés. */
export const termesRequete = requete => requete.replaceAll('"', ' ').split(/\s+/).filter(Boolean)

/**
 * Mots vides : mots-outils présents dans la plupart des pages, non indexés.
 * Une recherche sur l'un d'eux renvoyait presque toutes les pages du corpus et
 * prenait plusieurs secondes de calcul (Pagefind) ; ils alourdissaient l'index
 * d'environ un tiers. Écrits en graphie courante : ils passent par la même
 * normalisation que le texte (« vous » → « uous », « comme » → « conne »).
 * Les élisions (l', d', qu', n'…) sont découpées en mots d'une lettre.
 */
export const MOTS_VIDES = [
  'a', 'au', 'aux', 'avec', 'c', 'ce', 'ces', 'cette', 'comme', 'd', 'dans', 'de', 'des', 'du',
  'elle', 'en', 'est', 'et', 'i', 'ie', 'il', 'ils', 'je', 'l', 'la', 'le', 'les', 'leur', 'lui', 'luy',
  'm', 'mais', 'me', 'n', 'ne', 'nous', 'on', 'ont', 'ou', 'par', 'pas', 'pour', 'qu', 'qui', 's', 'sa',
  'se', 'ses', 'si', 'son', 'sont', 'sur', 'tu', 'un', 'une', 'vous', 'y',
]
