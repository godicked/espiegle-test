/**
 * pagefind.js — accès à l'index plein texte depuis le navigateur.
 *
 * L'index est généré au build par src/lib/indexRecherche.ts dans <base>/pagefind/ ;
 * seuls les fragments utiles à une requête sont téléchargés.
 *
 * Pagefind tourne dans un worker (pagefind.worker.js) : une recherche sur un mot
 * fréquent peut durer plusieurs secondes sans figer la page. Le calcul WASM ne
 * s'interrompt pas : quand une requête différente arrive alors que d'autres sont
 * en cours, le worker est terminé et recréé, les recherches dépassées sont rejetées
 * (AbortError). Les fichiers de l'index restent dans le cache HTTP.
 */
import { url } from './url'
import { SEPARATEUR_PAGES } from './tranches'
import { correspondAuTerme, termesRequete } from './normalisation.js'

let worker = null
let prochainId = 0
const enCours = new Map()   // id → { requete, resoudre, rejeter }

function demarrerWorker() {
  worker = new Worker(new URL('./pagefind.worker.js', import.meta.url), { type: 'module' })
  worker.onmessage = ({ data }) => {
    const attente = enCours.get(data.id)
    if (!attente) return
    enCours.delete(data.id)
    if (data.erreur) attente.rejeter(new Error(data.erreur))
    else attente.resoudre({ total: data.total, filters: data.filters, donnees: data.donnees })
  }
  worker.onerror = e => {
    for (const attente of enCours.values()) attente.rejeter(new Error(e.message || 'worker Pagefind'))
    enCours.clear()
    worker.terminate()
    worker = null
  }
}

function abandonnerSauf(requete) {
  const depassees = [...enCours.values()].filter(a => a.requete !== requete)
  if (depassees.length === 0) return
  worker.terminate()
  worker = null
  for (const [id, attente] of enCours) {
    if (attente.requete === requete) continue
    enCours.delete(id)
    attente.rejeter(new DOMException('recherche remplacée', 'AbortError'))
  }
  // Les recherches de la requête courante étaient dans le worker terminé : on les relance.
  const relancer = [...enCours.entries()]
  enCours.clear()
  for (const [, attente] of relancer) attente.relancer()
}

/**
 * Recherche Pagefind, sans ses correspondances de repli (vérifiées dans le worker).
 * Retourne { total, filters, donnees } : nombre de pages trouvées, comptes par
 * filtre, et les `nbDonnees` premiers fragments (content, locations, meta…).
 */
export function rechercher(requete, options = {}, nbDonnees = 0) {
  return new Promise((resoudre, rejeter) => {
    const attente = { requete, resoudre, rejeter }
    attente.relancer = () => {
      if (!worker) demarrerWorker()
      const id = prochainId++
      enCours.set(id, attente)
      worker.postMessage({ id, base: url('').replace(/\/+$/, ''), langue: document.documentElement.lang, requete, options, nbDonnees })
    }
    if (worker) abandonnerSauf(requete)
    attente.relancer()
  })
}

/**
 * Extraits affichables d'un résultat Pagefind (une tranche de pages) : un par page
 * qui contient la requête, dans l'ordre des pages. Chacun est la fenêtre de
 * `taille` mots qui contient le plus d'occurrences, mots trouvés marqués.
 *
 * Pagefind renvoie les positions dans `content` (texte normalisé de toute la
 * tranche). On les ramène page par page aux mots du texte original (meta.texte)
 * en refaisant le découpage de l'indexation : chaque mot original donne zéro
 * (mot vide), un ou plusieurs mots indexés.
 * `motsIndexes` : fonction de creerNormaliseur(), la même qu'à l'indexation.
 *
 * Pagefind exige tous les termes de la requête dans un même enregistrement, donc
 * dans la même tranche : seules sont gardées les pages qui contiennent chacun
 * des termes de `requete` (requête normalisée).
 *
 * Retourne [{ page, n, occurrences, segments, coupeAvant, coupeApres }].
 */
export function extraitsParPage(donnees, requete, motsIndexes, taille = 32) {
  const textes = donnees.meta.texte.split(SEPARATEUR_PAGES)
  const numeros = donnees.meta.n.split(SEPARATEUR_PAGES)
  const debutTranche = Number(donnees.meta.debut)

  // Position dans `content` → [page dans la tranche, mot dans la page]
  const pagesMots = textes.map(t => t.split(' '))
  const contenu = donnees.content.split(' ')
  const versMot = []
  pagesMots.forEach((mots, p) => mots.forEach((mot, i) => { for (const _ of motsIndexes(mot)) versMot.push([p, i]) }))
  if (versMot.length !== donnees.word_count) {
    console.warn(`[recherche] découpage différent de l'index (${versMot.length} ≠ ${donnees.word_count})`, donnees.url)
  }

  const marquesParPage = new Map()   // page → mots marqués (index dans la page)
  const trouvesParPage = new Map()   // page → mots indexés trouvés (normalisés)
  for (const pos of donnees.locations) {
    const cible = versMot[pos]
    if (!cible) continue
    if (!marquesParPage.has(cible[0])) { marquesParPage.set(cible[0], new Set()); trouvesParPage.set(cible[0], []) }
    marquesParPage.get(cible[0]).add(cible[1])
    trouvesParPage.get(cible[0]).push(contenu[pos] ?? '')
  }

  const termes = termesRequete(requete)
  const pagesRetenues = [...marquesParPage.keys()]
    .filter(p => termes.every(t => trouvesParPage.get(p).some(m => correspondAuTerme(t, m))))
    .sort((a, b) => a - b)

  return pagesRetenues.map(p => {
    const mots = pagesMots[p]
    const marquesSet = marquesParPage.get(p)
    const marques = [...marquesSet].sort((a, b) => a - b)

    // Début de fenêtre : celui qui couvre le plus de mots marqués
    let debut = 0
    let meilleur = -1
    for (const m of marques) {
      const d = Math.max(0, m - Math.floor(taille / 4))
      const n = marques.filter(x => x >= d && x < d + taille).length
      if (n > meilleur) { meilleur = n; debut = d }
    }
    const fin = Math.min(mots.length, debut + taille)

    const segments = []
    const ajouter = (texte, marque) => {
      const dernier = segments.at(-1)
      if (dernier && dernier.marque === marque) dernier.texte += texte
      else segments.push({ texte, marque })
    }
    for (let i = debut; i < fin; i++) {
      if (i > debut) ajouter(' ', false)   // les espaces restent hors des <mark>
      ajouter(mots[i], marquesSet.has(i))
    }

    return {
      page: debutTranche + p,
      n: numeros[p],
      occurrences: marques.length,
      segments,
      coupeAvant: debut > 0,
      coupeApres: fin < mots.length,
    }
  })
}
