/**
 * parseData.ts
 * Lit le CSV des métadonnées et les XML de transcription au moment du build Astro.
 * Détecte automatiquement les types de colonnes pour générer les facettes.
 * Détecte automatiquement le schéma XML et applique les règles de xmlRules.ts.
 */

import fs from 'node:fs'
import path from 'node:path'
import { XMLParser } from 'fast-xml-parser'
import { SCHEMA_RULES, detecterSchema, type XmlRuleMap } from './xmlRules'
import { compilerEquivalences } from './normalisation.js'

// Chemin vers les données — configurable via variable d'environnement
const DATA_PATH = process.env.DATA_PATH ?? path.resolve('./data')

// ─── Types ────────────────────────────────────────────────────────────────────

export type ColonneType = 'range' | 'select' | 'text' | 'reserved'

export interface ColonneMeta {
  key: string
  label: string
  type: ColonneType
  /** false si la colonne commence par `__` : affichée dans les tags mais pas proposée comme filtre. */
  filtrable: boolean
  valeurs?: string[]
  min?: number
  max?: number
}

export interface Livre {
  id: string
  /** Identifiant d'URL lisible dérivé du titre (slug). Unique par ouvrage. */
  slug: string
  titre: string
  sous_titre?: string
  auteur: string | string[]
  manifeste_url: string
  /** Éditions rattachées : lignes du CSV sans id qui suivent cet ouvrage. */
  editions?: Record<string, string>[]
  [key: string]: unknown
}

export interface LivreAvecTranscription extends Livre {
  transcriptionHtml: string
  transcriptionPages: TranscriptionPage[]
}

/** Texte brut d'une page, pour l'index de recherche (césures de fin de ligne recollées). */
export interface TextePage {
  index: number
  n: string | number
  texte: string
}

export interface TranscriptionPage {
  n: string | number
  html: string
  ancres: Ancre[]   // liste des ancres navigables de la page
}

export interface Ancre {
  id: string        // id HTML de l'élément
  label: string     // texte court pour affichage (premiers mots)
  pageN: string | number
  inPassages?: boolean
}

export interface Membre {
  nom: string
  description: string
  /** Une cellule `Liens` peut contenir plusieurs URLs. */
  liens: string[]
  /** Nom du fichier dans data/membres/. */
  avatar: string
}

// ─── Colonnes réservées ───────────────────────────────────────────────────────

// `slug` est calculé dans getLivres() : utilisable dans le code, jamais affiché ni filtrable.
const COLONNES_RESERVEES = new Set(['id', 'slug', 'titre', 'sous_titre', 'auteur', 'manifeste_url', 'editions'])

// ─── Lecture du CSV ──────────────────────────────────────────────────────────

function parseCSV(contenu: string): Record<string, string>[] {
  function tokeniser(csv: string): string[][] {
    const lignes: string[][] = []
    let ligneCourante: string[] = []
    let cellule = ''
    let dansGuillemets = false
    let i = 0
    while (i < csv.length) {
      const c = csv[i]
      const suivant = csv[i + 1]
      if (dansGuillemets) {
        if (c === '"' && suivant === '"') { cellule += '"'; i += 2 }
        else if (c === '"') { dansGuillemets = false; i++ }
        else { cellule += (c === '\r' || c === '\n') ? ' ' : c; i++ }
      } else {
        if (c === '"') { dansGuillemets = true; i++ }
        else if (c === ',') { ligneCourante.push(cellule.trim()); cellule = ''; i++ }
        else if (c === '\r' && suivant === '\n') {
          ligneCourante.push(cellule.trim()); lignes.push(ligneCourante)
          ligneCourante = []; cellule = ''; i += 2
        } else if (c === '\n' || c === '\r') {
          ligneCourante.push(cellule.trim()); lignes.push(ligneCourante)
          ligneCourante = []; cellule = ''; i++
        } else { cellule += c; i++ }
      }
    }
    if (cellule || ligneCourante.length > 0) { ligneCourante.push(cellule.trim()); lignes.push(ligneCourante) }
    return lignes
  }

  const toutes = tokeniser(contenu).filter(l => l.some(c => c !== ''))
  if (toutes.length < 2) return []
  // trim() retire aussi le BOM (U+FEFF) des exports Excel. Les colonnes sans nom sont ignorées.
  const entetes = toutes[0].map(h => h.replace(/\s+/g, ' ').trim())
  return toutes.slice(1).map(valeurs =>
    Object.fromEntries(entetes.map((h, i) => [h, valeurs[i] ?? '']).filter(([h]) => h !== ''))
  )
}

// ─── Détection automatique du type de colonne ────────────────────────────────

// Préfixe `__` : colonne exclue des filtres du moteur, mais affichée dans les tags de résultats.
// Combinable avec un préfixe de type, ex. `__select__langue`.
const PREFIXE_NON_FILTRABLE = '__'

function detecterTypeColonne(key: string, valeurs: string[]): ColonneType {
  if (key.startsWith(PREFIXE_NON_FILTRABLE)) key = key.slice(PREFIXE_NON_FILTRABLE.length)
  if (key.startsWith('range__')) return 'range'
  if (key.startsWith('select__')) return 'select'
  if (key.startsWith('text__')) return 'text'
  if (COLONNES_RESERVEES.has(key)) return 'reserved'
  const valeursNonVides = valeurs.filter(v => v !== '')
  if (valeursNonVides.length > 0 && valeursNonVides.every(v => !isNaN(Number(v)))) return 'range'
  const uniques = new Set(valeursNonVides)
  if (uniques.size <= 10) return 'select'
  return 'text'
}

/**
 * Transforme un titre en slug d'URL : sans accents, minuscules, mots séparés
 * par des tirets. Sert d'identifiant lisible dans les URLs /livres/<slug>.
 */
export function slugify(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // retire les diacritiques
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')       // tout caractère non alphanumérique → tiret
    .replace(/^-+|-+$/g, '')           // tirets de début/fin
}

export function nomLisible(key: string): string {
  const sansPrefixe = key.replace(/^(__)?((range|select|text)__)?/, '')
  return sansPrefixe.split('_').map(mot => mot.charAt(0).toUpperCase() + mot.slice(1)).join(' ')
}

// ─── Moteur de rendu XML → HTML (preserveOrder: true) ────────────────────────
//
// Avec preserveOrder:true, fast-xml-parser retourne des tableaux de nœuds.
// Chaque nœud est un objet avec UNE seule clé = nom de la balise (ou '#text').
// Les attributs sont dans une clé ':@' séparée, au même niveau que la balise.
//
// Exemple pour <Paragraph type="x"><Line>Hello</Line></Paragraph> :
// [
//   { ':@': { '@_type': 'x' }, Paragraph: [ { Line: [ { '#text': 'Hello' } ] } ] }
// ]

type OrdredNode = Record<string, unknown>

let ancreCounter = 0

function genAncreId(balise: string): string {
  return `${balise}-${++ancreCounter}`
}

/**
 * Extrait le texte brut d'un tableau de nœuds ordonnés.
 */
function extraireTexteOrdered(nodes: OrdredNode[]): string {
  return nodes
    .map(node => {
      const key = Object.keys(node).find(k => k !== ':@')
      if (!key) return ''
      if (key === '#text') return String(node[key])
      const enfants = node[key]
      return Array.isArray(enfants) ? extraireTexteOrdered(enfants as OrdredNode[]) : ''
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
}

/**
 * Convertit un tableau de nœuds ordonnés en HTML.
 * C'est la fonction principale récursive.
 */
function nodesVersHtml(
  nodes: OrdredNode[],
  rules: XmlRuleMap,
  pageN: string | number,
  ancres: Ancre[],
): string {
  let html = ''

  for (const node of nodes) {
    // Clé du nœud (nom de balise ou '#text'), ':@' contient les attributs
    const key = Object.keys(node).find(k => k !== ':@')
    if (!key) continue

    // Nœud texte
    if (key === '#text') {
      html += String(node[key])
      continue
    }

    const keyLower = key.toLowerCase()
    const rule = rules[keyLower]
    const attrs = (node[':@'] ?? {}) as Record<string, string>
    const enfants = (node[key] ?? []) as OrdredNode[]

    // Règle : ignorer complètement
    if (rule?.ignore) continue

    // Règle : traverser sans générer de balise
    if (rule?.skipSelf) {
      html += nodesVersHtml(enfants, rules, pageN, ancres)
      continue
    }

    // Contenu enfants
    const contenu = nodesVersHtml(enfants, rules, pageN, ancres)

    // Pas de règle connue → span générique
    if (!rule?.tag) {
      html += `<span class="transcription-${keyLower}">${contenu}</span>`
      continue
    }

    // Attributs HTML supplémentaires via la fonction attrs de la règle
    // On lui passe les attributs XML du nœud (normalisés sans préfixe @_)
    const attrsXml: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(attrs)) {
      attrsXml[k] = v  // k est déjà sous la forme '@_xxx'
    }
    const attrsExtra = rule.attrs ? rule.attrs(attrsXml) : {}

    // Ancre cliquable
    let ancreHtml = ''
    let idAttr = ''
    if (rule.anchorable) {
      const ancreId = genAncreId(keyLower)
      idAttr = ancreId
      const label = extraireTexteOrdered(enfants)
      ancres.push({ id: ancreId, label: label || keyLower, pageN, inPassages: rule.listePassages ?? false })
      ancreHtml = `<a class="transcription-ancre" href="#${ancreId}" aria-label="Lien direct vers ce passage" title="Lien direct">#</a>`
    }

    const attrsStr = [
      rule.classe ? `class="${rule.classe}"` : '',
      idAttr      ? `id="${idAttr}"`         : '',
      ...Object.entries(attrsExtra).map(([k, v]) => `${k}="${v}"`),
    ].filter(Boolean).join(' ')

    html += `<${rule.tag}${attrsStr ? ' ' + attrsStr : ''}>${ancreHtml}${contenu}</${rule.tag}>`
  }

  return html
}

// ─── Découpage en pages ───────────────────────────────────────────────────────

interface PageXml {
  n: string | number
  enfants: OrdredNode[]
}

/** Parse le XML et retourne ses pages (ou une page unique sans pagination) et les règles du schéma. */
function parserPages(xmlContenu: string): { pages: PageXml[], rules: XmlRuleMap } {
  const schemaName = detecterSchema(xmlContenu)
  const rules = SCHEMA_RULES[schemaName] ?? SCHEMA_RULES['default']

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    preserveOrder: true,       // ← préserve l'ordre et la structure exacte du XML
    textNodeName: '#text',
    removeNSPrefix: true,
  })

  let parsed: OrdredNode[]
  try {
    parsed = parser.parse(xmlContenu) as OrdredNode[]
  } catch (e) {
    console.error('[parseData] Erreur parsing XML:', e)
    return { pages: [], rules }
  }

  // Trouver la racine (ignorer '?xml')
  const racineNode = parsed.find(n => {
    const k = Object.keys(n).find(k => k !== ':@')
    return k && k !== '?xml'
  })
  if (!racineNode) return { pages: [], rules }

  const racineKey = Object.keys(racineNode).find(k => k !== ':@')!
  const racineEnfants = (racineNode[racineKey] ?? []) as OrdredNode[]

  // Chercher les nœuds <Page> (insensible à la casse)
  const pageNodes = racineEnfants.filter(n => {
    const k = Object.keys(n).find(k => k !== ':@')
    return k?.toLowerCase() === 'page'
  })

  // Pas de pagination → tout en une seule page
  if (pageNodes.length === 0) return { pages: [{ n: 1, enfants: racineEnfants }], rules }

  const pages = pageNodes.map(pageNode => {
    const pageKey = Object.keys(pageNode).find(k => k !== ':@')!
    const attrs = (pageNode[':@'] ?? {}) as Record<string, string>
    return { n: attrs['@_n'] ?? '?', enfants: (pageNode[pageKey] ?? []) as OrdredNode[] }
  })
  return { pages, rules }
}

function xmlVersPages(xmlContenu: string): TranscriptionPage[] {
  ancreCounter = 0
  const { pages, rules } = parserPages(xmlContenu)
  return pages.map(({ n, enfants }) => {
    const ancres: Ancre[] = []
    const html = nodesVersHtml(enfants, rules, n, ancres)
    return { n, html, ancres }
  })
}

// ─── Texte brut pour la recherche ─────────────────────────────────────────────

// Balises HTML de niveau bloc : leurs limites sont des fins de ligne (césures
// recollées) ; les balises en ligne (em, span, i…) n'ajoutent pas d'espace.
const BALISES_BLOC = new Set(['div', 'p', 'header', 'footer', 'section', 'figure', 'figcaption',
  'aside', 'blockquote', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

function nodesVersTexte(nodes: OrdredNode[], rules: XmlRuleMap): string {
  let texte = ''
  for (const node of nodes) {
    const key = Object.keys(node).find(k => k !== ':@')
    if (!key) continue
    if (key === '#text') { texte += String(node[key]); continue }
    const rule = rules[key.toLowerCase()]
    if (rule?.ignore) continue
    const contenu = nodesVersTexte((node[key] ?? []) as OrdredNode[], rules)
    const bloc = rule?.skipSelf || (rule?.tag !== undefined && BALISES_BLOC.has(rule.tag))
    texte += bloc ? `\n${contenu}\n` : contenu
  }
  return texte
}

/** Recolle les mots coupés en fin de ligne (« ren-⏎contre » → « rencontre ») et compacte les blancs. */
function texteDePage(brut: string): string {
  return brut.replace(/[-¬]\s*\n\s*/g, '').replace(/\s+/g, ' ').trim()
}

// ─── API publique ─────────────────────────────────────────────────────────────

export function getMembres(): Membre[] {
  const contenu = fs.readFileSync(path.join(DATA_PATH, 'membres', 'membres.csv'), 'utf-8')
  return parseCSV(contenu).map(ligne => ({
    nom: ligne['Nom'],
    description: ligne['Description'],
    liens: ligne['Liens'].match(/https?:\/\/\S+/g) ?? [],
    avatar: ligne['Avatars'],
  }))
}

// getLivres() est appelé par chaque page au build : le CSV n'est relu que s'il a changé.
let cacheLivres: { mtimeMs: number, livres: Livre[] } | null = null

export function getLivres(): Livre[] {
  const csvPath = path.join(DATA_PATH, 'metadata.csv')
  const { mtimeMs } = fs.statSync(csvPath)
  if (cacheLivres?.mtimeMs === mtimeMs) return cacheLivres.livres
  const contenu = fs.readFileSync(csvPath, 'utf-8')
  const lignes = parseCSV(contenu)

  // Une ligne sans id est considérée comme une édition de l'ouvrage précédent
  // (la dernière ligne possédant un id). On la replie dans son tableau `editions`.
  const livres: Livre[] = []
  // Garantit l'unicité des slugs : un titre dupliqué reçoit un suffixe -2, -3…
  const slugsUtilises = new Map<string, number>()
  // « Titre générique » : nom de colonne comparé sans casse ni accents (« Titre Générique »…)
  const colonneTitreGenerique = Object.keys(lignes[0] ?? {}).find(k => slugify(k) === 'titre-generique')
  for (const ligne of lignes) {
    if (ligne.id && ligne.id.trim() !== '') {
      // DOI Nakala (10.34847/nkl.xxxx) ramené à nkl.xxxx, comme les noms de fichiers
      // XML et manifestes (cf. data/scripts/2_nakala_vers_manifeste.py)
      const id = ligne.id.split('/').pop()!.trim()
      let slug = slugify(ligne[colonneTitreGenerique ?? ''] ?? '') || slugify(ligne.titre ?? '') || slugify(id)
      const n = slugsUtilises.get(slug) ?? 0
      slugsUtilises.set(slug, n + 1)
      if (n > 0) slug = `${slug}-${n + 1}`
      // Les colonnes réservées sont déclarées explicitement : une ligne de CSV
      // n'est qu'un Record<string, string>, rien ne garantit leur présence.
      livres.push({
        ...ligne,
        id,
        titre: ligne.titre ?? '',
        // Sans colonne manifeste_url, manifeste servi par le site s'il existe
        manifeste_url: ligne.manifeste_url
          || (fs.existsSync(path.join(DATA_PATH, 'manifestes', `${id}.json`)) ? `/manifestes/${id}.json` : ''),
        slug,
        auteur: ligne.auteur?.includes(';')
          ? ligne.auteur.split(';').map(a => a.trim())
          : ligne.auteur ?? '',
        editions: [],
      })
    } else if (livres.length > 0) {
      livres[livres.length - 1].editions!.push(ligne)
    }
  }
  cacheLivres = { mtimeMs, livres }
  return livres
}

// Dernier livre rendu : les tranches d'un livre (pages/livres/[slug]/tranches) sont
// générées à la suite et reparseraient sinon tout le XML pour chacune.
let cacheTranscription: { livre: Livre, mtimeMs: number, resultat: LivreAvecTranscription } | null = null

export function getLivreAvecTranscription(slugOuId: string): LivreAvecTranscription | null {
  const livres = getLivres()
  // Accepte le slug (URL publique) ou l'id nakala (appels internes / héritage)
  const livre = livres.find(l => l.slug === slugOuId || l.id === slugOuId)
  if (!livre) return null

  const xmlPath = cheminTranscription(livre.id)
  const mtimeMs = fs.existsSync(xmlPath) ? fs.statSync(xmlPath).mtimeMs : 0
  if (cacheTranscription?.livre === livre && cacheTranscription.mtimeMs === mtimeMs) return cacheTranscription.resultat
  let transcriptionPages: TranscriptionPage[] = []
  let transcriptionHtml = ''

  if (fs.existsSync(xmlPath)) {
    const xmlContenu = fs.readFileSync(xmlPath, 'utf-8')
    transcriptionPages = xmlVersPages(xmlContenu)
    transcriptionHtml = transcriptionPages.map(p => p.html).join('\n')
  }

  const resultat = { ...livre, transcriptionHtml, transcriptionPages }
  cacheTranscription = { livre, mtimeMs, resultat }
  return resultat
}

export function getColonnesMeta(livres: Livre[]): ColonneMeta[] {
  if (livres.length === 0) return []

  const colonnes = Object.keys(livres[0])

  return colonnes
    .map(key => {
      const valeurs = livres.map(l => String(l[key] ?? ''))
      const type = detecterTypeColonne(key, valeurs)
      if (type === 'reserved') return null
      // Colonne vide pour tous les livres : ni facette ni tag
      if (valeurs.every(v => v.trim() === '')) return null

      const meta: ColonneMeta = {
        key,
        label: nomLisible(key),
        type,
        filtrable: !key.startsWith(PREFIXE_NON_FILTRABLE),
      }

      if (type === 'select' || type === 'text') {
        meta.valeurs = [...new Set(valeurs.filter(v => v !== ''))].sort()
      }
      if (type === 'range') {
        const nombres = valeurs.filter(v => v !== '').map(Number)
        meta.min = Math.min(...nombres)
        meta.max = Math.max(...nombres)
      }

      return meta
    })
    .filter((m): m is ColonneMeta => m !== null)
}

// La transcription XML est toujours nommée d'après l'id nakala.
function cheminTranscription(id: string): string {
  return path.join(DATA_PATH, 'transcriptions', `${id}.xml`)
}

export function aTranscription(id: string): boolean {
  return fs.existsSync(cheminTranscription(id))
}

/** Contenu brut du XML de transcription d'un livre (téléchargement), ou null s'il n'existe pas */
export function getTranscriptionXml(id: string): string | null {
  return aTranscription(id) ? fs.readFileSync(cheminTranscription(id), 'utf-8') : null
}

/** Texte brut de chaque page d'un livre, pour l'index de recherche. Vide sans transcription. */
export function getTextePages(id: string): TextePage[] {
  const xml = getTranscriptionXml(id)
  if (xml === null) return []
  const { pages, rules } = parserPages(xml)
  return pages.map(({ n, enfants }, index) => ({ index, n, texte: texteDePage(nodesVersTexte(enfants, rules)) }))
}

/**
 * Règles d'équivalence de la recherche (data/equivalences.tsv), compilées pour
 * creerNormaliseur(). Règles vides si le fichier n'existe pas.
 */
export function getEquivalences(): ReturnType<typeof compilerEquivalences> {
  const tsvPath = path.join(DATA_PATH, 'equivalences.tsv')
  return compilerEquivalences(fs.existsSync(tsvPath) ? fs.readFileSync(tsvPath, 'utf-8') : '')
}
