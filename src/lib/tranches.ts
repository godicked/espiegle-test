/**
 * tranches.ts — découpage de la transcription d'un livre en tranches de pages.
 *
 * La page livre n'embarque que la première tranche ; les suivantes sont servies
 * par src/pages/livres/[slug]/tranches/[tranche].html.ts et chargées à la demande
 * par le script de src/pages/livres/[slug].astro. L'index de recherche a un
 * enregistrement par tranche (src/lib/indexRecherche.ts).
 */
import type { TranscriptionPage } from './parseData'

export const PAGES_PAR_TRANCHE = 20

/** Sépare les pages d'une tranche dans les meta de l'index de recherche (n, texte). */
export const SEPARATEUR_PAGES = '\u001f'

export const nbTranches = (nbPages: number) => Math.ceil(nbPages / PAGES_PAR_TRANCHE)

/**
 * HTML d'une page de transcription, identique qu'elle soit inline ou chargée.
 * La page 0 (toujours dans la page livre) est affichée d'emblée, même sans JS.
 */
export function htmlPage(page: TranscriptionPage, index: number): string {
  return `<div id="page-${index}" data-index="${index}" class="transcription-page${index === 0 ? ' active' : ''}">`
    + '<div class="transcription-page-entete"><span class="chip">'
    + `<span class="material-icons" style="font-size:14px">description</span>Page ${page.n}</span></div>`
    + `<div class="transcription-texte">${page.html}</div></div>`
}

export function htmlTranche(pages: TranscriptionPage[], tranche: number): string {
  const debut = tranche * PAGES_PAR_TRANCHE
  return pages.slice(debut, debut + PAGES_PAR_TRANCHE).map((p, i) => htmlPage(p, debut + i)).join('\n')
}

/**
 * Bornes des ancres : bornes[i] = nombre d'ancres des pages avant la page i
 * (longueur nbPages + 1). Les ids d'ancres sont numérotés dans l'ordre du livre
 * (« paragraph-123 », cf. genAncreId de parseData) : l'ancre n° k est dans la page i
 * telle que bornes[i] < k <= bornes[i + 1], même si cette page n'est pas chargée.
 */
export function bornesAncres(pages: TranscriptionPage[]): number[] {
  const bornes = [0]
  for (const p of pages) bornes.push(bornes[bornes.length - 1] + (p.ancres?.length ?? 0))
  return bornes
}
