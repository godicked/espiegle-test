/**
 * Liste des ouvrages de la barre de recherche de navigation (RechercheOuvrages.astro).
 *
 * Servie une fois plutôt qu'inlinée dans chaque page : le navigateur la met en
 * cache et ne la télécharge qu'au premier usage de la barre.
 */
import { getLivres } from '../lib/parseData'
import { url } from '../lib/url'

export function GET() {
  const ouvrages = getLivres().map(livre => {
    const auteur = Array.isArray(livre.auteur) ? livre.auteur.join(', ') : livre.auteur
    const titreGenerique = (livre['Titre générique'] ?? livre['Titre Générique'] ?? '') as string
    return {
      titre: titreGenerique || livre.titre,
      detail: titreGenerique && titreGenerique !== livre.titre ? livre.titre : '',
      auteur,
      href: url(`/livres/${livre.slug}`),
    }
  })
  return new Response(JSON.stringify(ouvrages), { headers: { 'Content-Type': 'application/json' } })
}
