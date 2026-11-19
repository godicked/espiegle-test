/**
 * Catalogue de la page de recherche, chargé par MoteurFacettes au montage.
 *
 * Servi à part plutôt qu'en props de l'île : la sérialisation des props Astro
 * double chaque valeur et embarquait les éditions (inutiles à la recherche).
 * Format en colonnes : { colonnes: [...], lignes: [[...], ...] }, une ligne par livre,
 * avec seulement les champs lus par la recherche, les cartes et l'export CSV.
 */
import { getLivres, getColonnesMeta } from '../lib/parseData'

export function GET() {
  const livres = getLivres()
  const colonnes = ['id', 'slug', 'titre', 'sous_titre', 'auteur', ...getColonnesMeta(livres).map(m => m.key)]
  const lignes = livres.map(l => colonnes.map(c => l[c] ?? ''))
  return new Response(JSON.stringify({ colonnes, lignes }), { headers: { 'Content-Type': 'application/json' } })
}
