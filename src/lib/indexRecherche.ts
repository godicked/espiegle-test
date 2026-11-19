/**
 * indexRecherche.ts — construit l'index plein texte Pagefind (build et dev).
 * Appelé par l'intégration `rechercheIndex()` d'astro.config.mjs.
 *
 * Un enregistrement Pagefind par tranche de pages (PAGES_PAR_TRANCHE, les mêmes
 * tranches que l'affichage de la page livre) : un enregistrement par page donnait
 * ~156 000 fichiers pour 600 livres, une indexation plus que linéaire et des
 * recherches lentes sur les mots fréquents (temps proportionnel au nombre de résultats).
 *   content : mots normalisés des pages de la tranche, à la suite (normalisation.js +
 *             data/equivalences.tsv, sans les mots vides), seul texte indexé ;
 *   meta    : livre (id nakala), debut (index de la première page = canvas IIIF),
 *             n (@n du XML de chaque page) et texte (texte original de chaque page,
 *             affiché dans les extraits), pages séparées par SEPARATEUR_PAGES ;
 *   filters : livre, pour restreindre une recherche aux livres retenus par les facettes.
 *
 * Chaque mot du texte original (découpé sur les espaces) donne zéro, un ou plusieurs
 * mots de `content`, dans l'ordre : le navigateur refait ce découpage pour situer
 * page par page les positions renvoyées par Pagefind (extraitsParPage, pagefind.js).
 */
import * as pagefind from 'pagefind'
import { getLivres, getTextePages, getEquivalences } from './parseData'
import { creerNormaliseur, LANGUE_INDEX } from './normalisation.js'
import { PAGES_PAR_TRANCHE, SEPARATEUR_PAGES } from './tranches'

export async function construireIndexRecherche(outputPath: string): Promise<{ livres: number, pages: number }> {
  const { motsIndexes } = creerNormaliseur(getEquivalences())
  const { index, errors } = await pagefind.createIndex()
  if (!index) throw new Error(`[recherche] Pagefind : ${errors.join(', ')}`)

  let livres = 0
  let pages = 0
  for (const livre of getLivres()) {
    const textePages = getTextePages(livre.id)
    if (textePages.length > 0) livres++
    for (let debut = 0; debut < textePages.length; debut += PAGES_PAR_TRANCHE) {
      const tranche = textePages.slice(debut, debut + PAGES_PAR_TRANCHE)
      const content = tranche.flatMap(p => p.texte.split(' ').flatMap(motsIndexes)).join(' ')
      if (!content) continue
      const resultat = await index.addCustomRecord({
        url: `/livres/${livre.slug}/#page-${debut}`,
        content,
        language: LANGUE_INDEX,
        meta: {
          livre: livre.id,
          debut: String(debut),
          n: tranche.map(p => String(p.n)).join(SEPARATEUR_PAGES),
          texte: tranche.map(p => p.texte).join(SEPARATEUR_PAGES),
        },
        filters: { livre: [livre.id] },
      })
      if (resultat.errors.length) console.warn(`[recherche] ${livre.id} pages ${debut}+ :`, resultat.errors)
      pages += tranche.length
    }
  }

  const ecriture = await index.writeFiles({ outputPath })
  if (ecriture.errors.length) throw new Error(`[recherche] Pagefind : ${ecriture.errors.join(', ')}`)
  await pagefind.close()
  return { livres, pages }
}
