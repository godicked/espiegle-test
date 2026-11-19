/**
 * pagefind.worker.js — exécute Pagefind hors du thread principal.
 *
 * Le calcul d'une recherche (WASM) peut durer plusieurs secondes sur un mot
 * fréquent : dans un worker, la page reste réactive et une recherche dépassée
 * s'interrompt en terminant le worker (voir src/lib/pagefind.js).
 *
 * Messages reçus : { id, base, langue, requete, options, nbDonnees }
 * Réponse : { id, total, filters, donnees } ou { id, erreur }
 */
import { correspondAuTerme, termesRequete } from './normalisation.js'

// Pagefind lit `document` et `window` à l'initialisation (langue de la page,
// origine) : absents dans un worker, l'accès lèverait une ReferenceError.
let langue = 'fr'
globalThis.document = { querySelector: () => ({ getAttribute: () => langue }) }
globalThis.window = undefined

let chargement = null

function chargerPagefind(base) {
  chargement ??= import(/* @vite-ignore */ `${base}/pagefind/pagefind.js`)
    .then(async pf => {
      await pf.options({ baseUrl: `${base}/` })
      await pf.init()
      return pf
    })
  return chargement
}

/**
 * Pagefind se rabat, pour un mot absent de l'index, sur son plus long préfixe
 * présent (voir correspondAuTerme). Un repli touche toute la recherche : on le
 * détecte sur le premier résultat.
 */
function correspondanceValide(requete, premier) {
  const contenu = premier.content.split(' ')
  const trouves = premier.locations.map(p => contenu[p] ?? '')
  return termesRequete(requete).every(t => trouves.some(m => correspondAuTerme(t, m)))
}

self.onmessage = async ({ data: { id, base, langue: l, requete, options, nbDonnees } }) => {
  try {
    langue = l || langue
    const pf = await chargerPagefind(base)
    const recherche = await pf.search(requete, options)
    const n = Math.max(1, nbDonnees)
    const donnees = await Promise.all(recherche.results.slice(0, n).map(r => r.data()))
    if (donnees.length && !correspondanceValide(requete, donnees[0])) {
      self.postMessage({ id, total: 0, filters: {}, donnees: [] })
      return
    }
    self.postMessage({ id, total: recherche.results.length, filters: recherche.filters, donnees: donnees.slice(0, nbDonnees) })
  } catch (e) {
    self.postMessage({ id, erreur: String(e?.message ?? e) })
  }
}
